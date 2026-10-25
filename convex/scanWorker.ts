import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { audit } from "./lib/access";
import { fail } from "./lib/errors";
import { workerMutation, workerQuery } from "./lib/worker";
import { fontSpec } from "./schema";

// Worker-only writes for the scan stages crawl → extract_design → analyse (PRD F4–F6). Every
// write is an idempotent upsert on its natural key, so a resumed slice repeats nothing.

const ACTOR = "system:scan";
/** Convex documents cap at 1 MiB; page text beyond this adds nothing to analysis. */
export const MAX_PAGE_CHARS = 100_000;

/** The name the create-space screen derives from the website ("acme-pay.com" → "Acme-pay"). */
export function hostDefaultName(host: string) {
  return host.split(/[./]/)[0].replace(/^./, (c) => c.toUpperCase());
}

async function scanOr404(ctx: MutationCtx, scanId: Id<"scans">) {
  const scan = await ctx.db.get(scanId);
  if (!scan) return fail(404, "Scan not found");
  return scan;
}

export const upsertCrawlPage = workerMutation({
  args: { scanId: v.id("scans"), url: v.string(), title: v.optional(v.string()), text: v.string(), contentHash: v.string() },
  handler: async (ctx, { scanId, url, title, text, contentHash }) => {
    const scan = await scanOr404(ctx, scanId);
    const row = { title: title?.slice(0, 300), text: text.slice(0, MAX_PAGE_CHARS), contentHash, fetchedAt: Date.now() };
    const existing = await ctx.db.query("crawl_pages").withIndex("by_scan_url", (q) => q.eq("scanId", scanId).eq("url", url)).first();
    if (existing) {
      await ctx.db.patch(existing._id, row);
      return existing._id;
    }
    return await ctx.db.insert("crawl_pages", { scanId, spaceId: scan.spaceId, url, ...row });
  },
});

/** Short-lived URL the worker POSTs screenshot/logo bytes to (Convex file storage). */
export const generateUploadUrl = workerMutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const storageUrl = workerMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});

export const setPageScreenshot = workerMutation({
  args: { scanId: v.id("scans"), url: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { scanId, url, storageId }) => {
    const page = await ctx.db.query("crawl_pages").withIndex("by_scan_url", (q) => q.eq("scanId", scanId).eq("url", url)).first();
    if (!page) return fail(404, "Crawl page not found");
    if (page.screenshotRef && page.screenshotRef !== storageId) await ctx.storage.delete(page.screenshotRef);
    await ctx.db.patch(page._id, { screenshotRef: storageId });
  },
});

/** Recount the scan's pages (idempotent) and close the website connector's sync. */
export const finishCrawl = workerMutation({
  args: { scanId: v.id("scans"), connectorId: v.id("connectors"), removed: v.number() },
  handler: async (ctx, { scanId, connectorId, removed }) => {
    const scan = await scanOr404(ctx, scanId);
    const pages = await ctx.db.query("crawl_pages").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
    await ctx.db.patch(scanId, { pageCount: pages.length });
    await ctx.db.patch(connectorId, { status: "ready", lastSyncedAt: Date.now(), error: undefined, label: new URL(scan.url).host });
    await audit(ctx, scan.spaceId, ACTOR, "scan.crawled", { scanId, pages: pages.length, removed });
    return pages.length;
  },
});

export const listCrawlPages = workerQuery({
  args: { scanId: v.id("scans"), maxChars: v.optional(v.number()) },
  handler: async (ctx, { scanId, maxChars }) => {
    const pages = await ctx.db.query("crawl_pages").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
    return pages.map((p) => ({ url: p.url, title: p.title ?? "", text: p.text.slice(0, maxChars ?? 8000), screenshotRef: p.screenshotRef ?? null }));
  },
});

export const brandProfileForScan = workerQuery({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => await ctx.db.query("brand_profiles").withIndex("by_scan", (q) => q.eq("scanId", scanId)).first(),
});

const paletteEntry = v.object({
  name: v.string(),
  hex: v.string(),
  role: v.union(v.literal("primary"), v.literal("accent"), v.literal("surface"), v.literal("text")),
});
const logoRef = v.object({ kind: v.union(v.literal("mark"), v.literal("wordmark"), v.literal("favicon")), url: v.string(), format: v.string() });

/**
 * One brand profile per scan (re-sending is a no-op). A new profile gets the space's next
 * `tokensVersion`, becomes `spaces.brandProfileId`, and — when it replaces an older profile —
 * flags the space's courses `needsRefresh` (their specs were generated against older tokens).
 * The space name is refined from the site's real company name only while it is still the
 * host-derived default, so a manager's rename is never overwritten.
 */
export const saveBrandProfile = workerMutation({
  args: {
    spaceId: v.id("spaces"),
    scanId: v.id("scans"),
    palette: v.array(paletteEntry),
    typography: v.object({ heading: fontSpec, body: fontSpec, notes: v.string() }),
    logoRefs: v.array(logoRef),
    voice: v.string(),
    radius: v.optional(v.string()),
    quality: v.union(v.literal("full"), v.literal("partial"), v.literal("offline")),
    candidates: v.optional(v.any()),
    companyName: v.optional(v.string()),
  },
  handler: async (ctx, { companyName, ...profile }) => {
    const space = await ctx.db.get(profile.spaceId);
    if (!space) return fail(404, "Space not found");
    const already = await ctx.db.query("brand_profiles").withIndex("by_scan", (q) => q.eq("scanId", profile.scanId)).first();
    if (already) return { brandProfileId: already._id, tokensVersion: already.tokensVersion, created: false };

    const previous = await ctx.db.query("brand_profiles").withIndex("by_space", (q) => q.eq("spaceId", profile.spaceId)).collect();
    const tokensVersion = previous.reduce((m, p) => Math.max(m, p.tokensVersion), 0) + 1;
    const brandProfileId = await ctx.db.insert("brand_profiles", { ...profile, tokensVersion });

    const patch: { brandProfileId: Id<"brand_profiles">; name?: string; mode: "live" | "offline" } = {
      brandProfileId,
      mode: profile.quality === "offline" ? "offline" : "live",
    };
    const name = companyName?.trim();
    if (name && name.length <= 80 && name !== space.name && space.name === hostDefaultName(space.host)) patch.name = name;
    await ctx.db.patch(profile.spaceId, patch);

    let flagged = 0;
    if (previous.length) {
      const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", profile.spaceId)).collect();
      for (const c of courses) {
        if (c.needsRefresh || c.status === "archived") continue;
        await ctx.db.patch(c._id, { needsRefresh: true });
        flagged++;
      }
    }
    await audit(ctx, profile.spaceId, ACTOR, "brand.extracted", {
      scanId: profile.scanId,
      brandProfileId,
      tokensVersion,
      quality: profile.quality,
      renamed: patch.name ? { from: space.name, to: patch.name } : undefined,
      coursesFlagged: flagged,
    });
    return { brandProfileId, tokensVersion, created: true };
  },
});

export const saveFindings = workerMutation({
  args: { scanId: v.id("scans"), findings: v.any() },
  handler: async (ctx, { scanId, findings }) => {
    const scan = await scanOr404(ctx, scanId);
    await ctx.db.patch(scanId, { findings });
    const mode = (findings as { mode?: unknown })?.mode;
    if (mode === "live" || mode === "offline") await ctx.db.patch(scan.spaceId, { mode });
    await audit(ctx, scan.spaceId, ACTOR, "scan.analysed", { scanId, mode: (findings as { mode?: string })?.mode });
  },
});
