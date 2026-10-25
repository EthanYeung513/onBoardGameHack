// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup(name = "Acme-pay") {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name, website: "acme-pay.com" });
  const scanId = await mgr.mutation(api.scans.start, { spaceId });
  return { t, mgr, spaceId, scanId };
}

const profile = (primary: string) => ({
  palette: [
    { name: "Primary", hex: primary, role: "primary" as const },
    { name: "Accent", hex: "#ff6118", role: "accent" as const },
    { name: "Surface", hex: "#ffffff", role: "surface" as const },
    { name: "Text", hex: "#061b31", role: "text" as const },
  ],
  typography: { heading: { family: "Sohne" }, body: { family: "Sohne" }, notes: "" },
  logoRefs: [],
  voice: "Plain and confident.",
  quality: "full" as const,
  candidates: { palette: [{ value: primary, count: 12, evidence: ["dembrandt"], hints: [] }] },
});

describe("scan worker mutations", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("upserts crawl pages on (scan, url) and counts them when the crawl finishes", async () => {
    const { t, spaceId, scanId } = await setup();
    const page = { secret, scanId, url: "https://acme-pay.com/about", title: "About", text: "v1", contentHash: "h1" };
    const a = await t.mutation(api.scanWorker.upsertCrawlPage, page);
    const b = await t.mutation(api.scanWorker.upsertCrawlPage, { ...page, text: "v2", contentHash: "h2" });
    expect(b).toBe(a);
    await t.mutation(api.scanWorker.upsertCrawlPage, { ...page, url: "https://acme-pay.com" });
    const connectorId = await t.mutation(api.ingest.ensureConnector, { secret, spaceId, type: "website" });
    expect(await t.mutation(api.scanWorker.finishCrawl, { secret, scanId, connectorId, removed: 0 })).toBe(2);
    const [rows, scan, connector] = await t.run(async (ctx) => [await ctx.db.query("crawl_pages").collect(), await ctx.db.get(scanId), await ctx.db.get(connectorId)] as const);
    expect(rows.find((r) => r._id === a)).toMatchObject({ text: "v2", contentHash: "h2" });
    expect(scan?.pageCount).toBe(2);
    expect(connector).toMatchObject({ status: "ready", label: "acme-pay.com" });
  });

  it("saves one brand profile per scan, sets brandProfileId, bumps tokensVersion and refines the default name", async () => {
    const { t, mgr, spaceId, scanId } = await setup();
    const first = await t.mutation(api.scanWorker.saveBrandProfile, { secret, spaceId, scanId, ...profile("#533afd"), companyName: "Acme Pay" });
    expect(first).toMatchObject({ tokensVersion: 1, created: true });
    // Re-sending (a resumed slice) is a no-op.
    expect(await t.mutation(api.scanWorker.saveBrandProfile, { secret, spaceId, scanId, ...profile("#000000") })).toMatchObject({ brandProfileId: first.brandProfileId, created: false });
    let space = await mgr.query(api.spaces.get, { spaceId });
    expect(space).toMatchObject({ name: "Acme Pay", brandProfileId: first.brandProfileId, mode: "live" });
    expect(space.brand?.palette[0].hex).toBe("#533afd");
    expect(space.brand?.candidates.palette[0]).toMatchObject({ value: "#533afd", count: 12 });

    // A re-scan: a manager rename sticks, the version bumps and courses are flagged for refresh.
    await mgr.mutation(api.spaces.update, { spaceId, name: "ACME Payments" });
    const courseId = await t.run((ctx) => ctx.db.insert("courses", { spaceId, packType: "company", title: "Company", icon: "🏢", building: "hq", game: "quiz", spec: {}, status: "published", needsRefresh: false, version: 1 }));
    const scan2 = await t.run((ctx) => ctx.db.insert("scans", { spaceId, url: "https://acme-pay.com", status: "running", progress: 0, pageCount: 0 }));
    const second = await t.mutation(api.scanWorker.saveBrandProfile, { secret, spaceId, scanId: scan2, ...profile("#635bff"), companyName: "Acme Pay" });
    expect(second.tokensVersion).toBe(2);
    space = await mgr.query(api.spaces.get, { spaceId });
    expect(space).toMatchObject({ name: "ACME Payments", brandProfileId: second.brandProfileId });
    expect((await t.run((ctx) => ctx.db.get(courseId)))?.needsRefresh).toBe(true);
  });

  it("stores findings on the scan, sets the space mode, and rejects callers without the worker secret", async () => {
    const { t, mgr, scanId } = await setup();
    await t.mutation(api.scanWorker.saveFindings, { secret, scanId, findings: { companyName: "Acme Pay", mode: "offline" } });
    expect((await mgr.query(api.scans.get, { scanId })).findings).toMatchObject({ companyName: "Acme Pay" });
    expect((await t.run((ctx) => ctx.db.query("spaces").first()))?.mode).toBe("offline"); // drives the offline pill
    await expect(t.mutation(api.scanWorker.saveFindings, { secret: "nope", scanId, findings: {} })).rejects.toThrow(/401/);
  });
});
