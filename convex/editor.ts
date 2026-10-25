import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";

// Read model for the editor (editor.html → /editor?space=&course=). Writes go through the owners'
// mutations: `courses.applyPatch` / `courses.regenerateSteps` (course generation, D-26) and
// `brand.decide` (brand learning, D-27). This file only assembles what the screen shows.

type SpecStep = { id?: string; kind?: string; title?: string; teaches_fact_ids?: string[] };

export type StaleSource = { type: string; title: string; url?: string };

const MAX_SOURCES_PER_STEP = 3;

/** Steps needing a refresh, each with the changed sources behind it (F36 made visible). */
async function staleSteps(ctx: QueryCtx, course: Doc<"courses">): Promise<Record<string, StaleSource[]>> {
  const steps: SpecStep[] = Array.isArray(course.spec?.steps) ? course.spec.steps : [];
  const flagged = new Set(course.staleStepIds ?? []);
  const out: Record<string, StaleSource[]> = {};
  const connectorType = new Map<string, string>();
  for (const step of steps) {
    if (!step.id) continue;
    const sources = new Map<string, StaleSource>();
    let staleFact = false;
    for (const raw of step.teaches_fact_ids ?? []) {
      const factId = ctx.db.normalizeId("facts", raw);
      const fact = factId ? await ctx.db.get(factId) : null;
      if (!fact || fact.spaceId !== course.spaceId || fact.status !== "stale") continue;
      staleFact = true;
      const citations = await ctx.db.query("fact_citations").withIndex("by_fact", (q) => q.eq("factId", fact._id)).collect();
      for (const c of citations) {
        if (sources.size >= MAX_SOURCES_PER_STEP || sources.has(c.sourceItemId)) continue;
        const item = await ctx.db.get(c.sourceItemId);
        if (!item) continue;
        let type = "website";
        if (item.connectorId) {
          if (!connectorType.has(item.connectorId)) connectorType.set(item.connectorId, (await ctx.db.get(item.connectorId))?.type ?? "website");
          type = connectorType.get(item.connectorId)!;
        }
        sources.set(c.sourceItemId, { type, title: item.title, url: item.url });
      }
    }
    if (staleFact || flagged.has(step.id)) out[step.id] = [...sources.values()];
  }
  return out;
}

/** Live course-generation status for the empty state ("long operations show live job_events"). */
async function generation(ctx: QueryCtx, spaceId: Id<"spaces">) {
  const jobs = await ctx.db.query("jobs").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").take(50);
  const job = jobs.find((j) => j.stage === "generate_courses" && (j.status === "queued" || j.status === "running"));
  if (!job) return null;
  const events = await ctx.db.query("job_events").withIndex("by_job", (q) => q.eq("jobId", job._id)).order("desc").take(4);
  return { status: job.status, progress: job.progress, lines: events.reverse().map((e) => e.message) };
}

export const load = query({
  args: { spaceId: v.id("spaces"), courseId: v.optional(v.id("courses")) },
  handler: async (ctx, { spaceId, courseId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const brand = space.brandProfileId ? await ctx.db.get(space.brandProfileId) : null;
    const courses = (await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect())
      .filter((c) => c.status !== "archived")
      .sort((a, b) => a._creationTime - b._creationTime);
    let course: Doc<"courses"> | null = courses[0] ?? null;
    if (courseId) {
      course = courses.find((c) => c._id === courseId) ?? null;
      if (!course) fail(404, "Course not found");
    }
    return {
      space: { _id: space._id, name: space.name, host: space.host, status: space.status, mode: space.mode },
      brand,
      courses: courses.map((c) => ({ _id: c._id, title: c.title, needsRefresh: c.needsRefresh })),
      course: course
        ? {
            _id: course._id,
            title: course.title,
            building: course.building,
            game: course.game,
            version: course.version,
            needsRefresh: course.needsRefresh,
            spec: course.spec,
            staleSteps: await staleSteps(ctx, course),
          }
        : null,
      generating: await generation(ctx, spaceId),
    };
  },
});

export type EditorAsset = {
  id: string;
  name: string;
  /** Thumbnail: an image URL, a colour, or text. */
  thumb: { image?: string; color?: string; text?: string };
  meta: string;
  category: "brand" | "colors" | "type" | "icons" | "copy";
  /** Where the asset was found (crawled page or source URL). */
  foundAt?: string;
};

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|ico|avif)(\?|#|$)/i;
const str = (x: unknown) => (typeof x === "string" && x ? x : undefined);

/** Assets tab: scraped logos + tokens from brand_profiles and `asset`/`screenshot` source_items. */
export const assets = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const brand = space.brandProfileId ? await ctx.db.get(space.brandProfileId) : null;
    const scan = brand?.scanId ? await ctx.db.get(brand.scanId) : null;
    const scanUrl = scan?.url ?? `https://${space.host}`;
    const out: EditorAsset[] = [];
    if (brand) {
      const logoName = { mark: "Logo mark", wordmark: "Wordmark", favicon: "Favicon" } as const;
      brand.logoRefs.forEach((l, i) =>
        out.push({
          id: `logo-${i}`,
          name: logoName[l.kind],
          thumb: { image: l.url },
          meta: `${l.format.toUpperCase()} · ${l.kind}`,
          category: l.kind === "favicon" ? "icons" : "brand",
          foundAt: l.url,
        }),
      );
      brand.palette.forEach((p, i) =>
        out.push({ id: `color-${i}`, name: p.name, thumb: { color: p.hex, text: p.hex }, meta: `color · ${p.role}`, category: "colors", foundAt: scanUrl }),
      );
      const { heading, body } = brand.typography;
      out.push({ id: "font-heading", name: "Heading font", thumb: { text: `Aa — ${heading.family}` }, meta: `type · ${heading.weight ?? "heading"}`, category: "type", foundAt: scanUrl });
      out.push({ id: "font-body", name: "Body font", thumb: { text: `Aa — ${body.family}` }, meta: `type · ${body.weight ?? "body"}`, category: "type", foundAt: scanUrl });
      if (brand.voice) out.push({ id: "voice", name: "Voice", thumb: { text: brand.voice.slice(0, 40) }, meta: "TXT · scraped", category: "copy", foundAt: scanUrl });
    }
    const items = await ctx.db.query("source_items").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    for (const item of items) {
      if ((item.kind !== "asset" && item.kind !== "screenshot") || item.removedAt) continue;
      const meta = (item.meta ?? {}) as Record<string, unknown>;
      const stored = item.rawRef ? await ctx.storage.getUrl(item.rawRef) : null;
      const src = str(meta.src) ?? str(meta.imageUrl) ?? (item.url && IMAGE_RE.test(item.url) ? item.url : undefined);
      const image = stored ?? src;
      const format = str(meta.format) ?? (image?.match(IMAGE_RE)?.[1]?.toUpperCase() || (item.kind === "screenshot" ? "PNG" : "asset"));
      const size = typeof meta.width === "number" && typeof meta.height === "number" ? ` · ${meta.width}×${meta.height}` : "";
      out.push({
        id: item._id,
        name: item.title,
        thumb: image ? { image } : { text: item.title.slice(0, 24) },
        meta: `${format}${size}${item.kind === "screenshot" ? " · screenshot" : ""}`,
        category: str(meta.category) === "icon" ? "icons" : "brand",
        foundAt: str(meta.foundOn) ?? str(meta.pageUrl) ?? item.url,
      });
    }
    return { host: space.host, assets: out };
  },
});
