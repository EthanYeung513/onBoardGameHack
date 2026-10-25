// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

/** A space with a brand profile whose candidates came from extract_design, and one published course. */
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const owner = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await owner.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  const ids = await t.run(async (ctx) => {
    const profileId = await ctx.db.insert("brand_profiles", {
      spaceId,
      tokensVersion: 1,
      palette: [{ name: "Ink", hex: "#111111", role: "text" }],
      typography: { heading: { family: "Inter" }, body: { family: "Inter" }, notes: "" },
      logoRefs: [],
      voice: "plain",
      radius: "4px",
      // The scan-stages extract_design shape (src/lib/brand/candidates.ts).
      ...{
        candidates: {
          palette: [
            { value: "#111111", count: 90, evidence: ["stylesheets: 90 rules"], hints: [{ role: "text", by: "css" }] },
            { value: "#635bff", count: 30, evidence: ["css var --brand-primary"], hints: [{ role: "primary", by: "css" }] },
            { value: "#ff7a00", count: 12, evidence: ["css var --accent"], hints: [{ role: "accent", by: "css" }] },
          ],
          radius: [{ value: "8px", count: 40, evidence: [], hints: [] }, { value: "999px", count: 10, evidence: [], hints: [] }],
          headline: [{ value: "Sohne", count: 20, evidence: [], hints: [{ role: "headline", by: "model" }] }],
          body: [{ value: "Inter", count: 50, evidence: [], hints: [] }],
        },
      },
    });
    const courseId = await ctx.db.insert("courses", { spaceId, packType: "company", title: "Company", icon: "🏢", building: "hq", game: "quiz", spec: {}, status: "published", needsRefresh: false, version: 1 });
    return { profileId, courseId };
  });
  return { t, owner, userId, spaceId, ...ids };
}

describe("brand.options / brand.decide (F37)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("offers candidates with the recommendation first (heuristic on cold start)", async () => {
    const { owner, spaceId } = await setup();
    const o = await owner.query(api.brand.options, { spaceId });
    expect(o?.fields.primary).toMatchObject({ recommended: "#635bff", source: "heuristic" });
    expect(o?.fields.primary.candidates[0].value).toBe("#635bff");
    expect(o?.fields.accent.recommended).toBe("#ff7a00");
    expect(o?.fields.headline.recommended).toBe("Sohne");
    expect(o?.fields.radius.current).toBe("4px");
  });

  it("stores the evidence, bumps tokensVersion, marks courses stale, audits and schedules the Mubit loop", async () => {
    const { t, owner, spaceId, profileId, courseId } = await setup();
    const r = await owner.mutation(api.brand.decide, { spaceId, field: "radius", chosen: "999px" });
    expect(r).toMatchObject({ accepted: false, tokensVersion: 2, coursesStale: 1 });
    const [profile, course, decisions, audits, scheduled] = await t.run(async (ctx) => [
      await ctx.db.get(profileId),
      await ctx.db.get(courseId),
      await ctx.db.query("brand_decisions").collect(),
      await ctx.db.query("audit_events").collect(),
      await ctx.db.system.query("_scheduled_functions").collect(),
    ] as const);
    expect(profile).toMatchObject({ radius: "999px", tokensVersion: 2 });
    expect(course).toMatchObject({ status: "stale", needsRefresh: true });
    const d = decisions[0];
    expect(d).toMatchObject({ field: "radius", chosen: "999px", recommended: "8px", recommendedSource: "heuristic", accepted: false, tokensVersion: 2 });
    expect(d.companyProfile.host).toBe("acme.com");
    expect(d.features.map((f) => f.value)).toEqual(expect.arrayContaining(["8px", "999px"]));
    expect(d.chosenFeatures.pill).toBe(1);
    expect(audits.map((a) => a.kind)).toEqual(expect.arrayContaining(["brand.decided", "course.needs_refresh"]));
    expect(scheduled.map((s) => s.name)).toContain("brandLoop:send");

    // Accepting the recommendation is recorded as accepted.
    const ok = await owner.mutation(api.brand.decide, { spaceId, field: "primary", chosen: "#635BFF" });
    expect(ok).toMatchObject({ accepted: true, tokensVersion: 3 });
    expect(await t.run(async (ctx) => (await ctx.db.get(profileId))?.palette.find((p) => p.role === "primary")?.hex)).toBe("#635bff");
  });

  it("rejects outsiders, hires and values that aren't tokens", async () => {
    const { t, owner, spaceId } = await setup();
    const eveId = await t.run((ctx) => ctx.db.insert("users", { email: "eve@evil.com" }));
    const eve = t.withIdentity({ subject: `${eveId}|s` });
    await expect(eve.mutation(api.brand.decide, { spaceId, field: "primary", chosen: "#000000" })).rejects.toThrow(/access/);
    await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: eveId, role: "hire" }));
    await expect(eve.query(api.brand.options, { spaceId })).rejects.toThrow(/access/);
    await expect(owner.mutation(api.brand.decide, { spaceId, field: "primary", chosen: "url(javascript:1)" })).rejects.toThrow(/not a valid primary/);
    await expect(t.mutation(api.brand.decide, { spaceId, field: "primary", chosen: "#000000" })).rejects.toThrow(/Sign in/);
  });

  it("serves the stored scan-time Mubit recommendation and keys feedback by its request id", async () => {
    const { t, owner, spaceId } = await setup();
    const fields = Object.fromEntries(
      (["primary", "accent", "radius", "headline"] as const).map((f) => [f, { candidates: [{ value: f === "radius" ? "8px" : f === "headline" ? "Sohne" : f === "primary" ? "#635bff" : "#ff7a00", evidence: "x" }], recommended: f === "radius" ? "8px" : f === "headline" ? "Sohne" : f === "primary" ? "#635bff" : "#ff7a00", reason: "learned", source: "mubit" }]),
    );
    const recommendation = { fields, requestId: "mreq_123", companyProfile: { host: "acme.com", paletteSummary: "" }, features: { primary: [], accent: [], radius: [], headline: [] }, featureVersion: 2, computedAt: 1 };
    expect(await t.mutation(api.brand.saveRecommendation, { secret, spaceId, recommendation, apply: false })).toEqual({ saved: true });
    const o = await owner.query(api.brand.options, { spaceId });
    expect(o).toMatchObject({ requestId: "mreq_123", fields: { primary: { source: "mubit" } } });

    const { decisionId } = await owner.mutation(api.brand.decide, { spaceId, field: "radius", chosen: "12px" });
    vi.stubEnv("MUBIT_API_KEY", "k");
    vi.stubEnv("MUBIT_FEEDBACK_URL", "https://mubit.test/feedback");
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await t.action(internal.brandLoop.send, { decisionId: decisionId as Id<"brand_decisions"> });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mubit.test/feedback");
    expect(JSON.parse(String(init.body))).toMatchObject({ request_id: "mreq_123", task: "brand.recommend", verdict: "correct", corrected_output: { radius: { recommended: "12px" } } });
    const [d, audits] = await t.run(async (ctx) => [await ctx.db.get(decisionId), await ctx.db.query("audit_events").collect()] as const);
    expect(d?.loop).toMatchObject({ feedback: { sink: "mubit", delivered: true }, memory: { status: "skipped" } });
    expect(audits.map((a) => a.kind)).toEqual(expect.arrayContaining(["brand.feedback", "brand.memory"]));
  });

  it("builds theme options from the profile and a theme pick applies its tokens as brand decisions (D-34)", async () => {
    const { t, owner, spaceId, profileId, courseId } = await setup();
    expect(await owner.query(api.brand.themes, { spaceId })).toMatchObject({ themes: [], themeId: null });
    const style = { glass: 1, translucent: 2, gradients: 1, shadows: 3, roundRadius: 22 };
    const saved = await t.mutation(api.brand.saveThemes, { secret, spaceId, style });
    expect(saved.styles).toContain("glass");
    const o = await owner.query(api.brand.themes, { spaceId });
    expect(o?.themeId).toBe("signature");
    const glass = o!.themes.find((th) => th.style === "glass" && th.id === "glass")!;
    expect(glass.radius).toBe("22px");

    const r = await owner.mutation(api.brand.pickTheme, { spaceId, themeId: "glass" });
    expect(r).toMatchObject({ tokensVersion: 2, coursesStale: 1 });
    const [profile, course, decisions] = await t.run(async (ctx) => [await ctx.db.get(profileId), await ctx.db.get(courseId), await ctx.db.query("brand_decisions").collect()] as const);
    expect(profile).toMatchObject({ themeId: "glass", themeStyle: "glass", radius: "22px", tokensVersion: 2 });
    expect(profile?.palette.find((p) => p.role === "surface")?.hex).toBe(glass.palette.surface);
    expect(course?.needsRefresh).toBe(true);
    // Theme picks feed the same learning loop as Design-tab picks.
    expect(decisions.map((d) => d.field).sort()).toEqual(["accent", "primary", "radius"]);
    expect(decisions.every((d) => d.tokensVersion === 2)).toBe(true);
    await expect(owner.mutation(api.brand.pickTheme, { spaceId, themeId: "nope" })).rejects.toThrow(/not one of/);
  });
});
