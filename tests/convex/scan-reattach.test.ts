// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  return { t, mgr, spaceId };
}

describe("scan re-attach + next step", () => {
  it("a running scan is found again after a reload, and login lands on its progress", async () => {
    const { t, mgr, spaceId } = await setup();
    expect(await mgr.query(api.scans.inFlight, {})).toBeNull();
    expect((await mgr.query(api.users.viewer, {}))?.home).toBe("/dashboard");
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    expect(await mgr.query(api.scans.inFlight, {})).toEqual({ spaceId, scanId });
    expect((await mgr.query(api.users.viewer, {}))?.home).toBe(`/space/new?space=${spaceId}&scan=${scanId}`);
    expect(await mgr.query(api.scans.nextStep, { spaceId })).toEqual({ kind: "scanning", scanId });
    expect(await t.query(api.scans.inFlight, {})).toBeNull(); // signed out
  });

  it("after a finished scan with a brand and no design picks, the dashboard points to the design pick", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    await t.run(async (ctx) => {
      await ctx.db.patch(scanId, { status: "succeeded" });
      const bp = await ctx.db.insert("brand_profiles", { spaceId, scanId, tokensVersion: 1, palette: [], typography: { heading: { family: "Inter" }, body: { family: "Inter" }, notes: "" }, logoRefs: [], voice: "" });
      await ctx.db.patch(spaceId, { brandProfileId: bp });
    });
    expect(await mgr.query(api.scans.nextStep, { spaceId })).toEqual({ kind: "pickDesign", scanId });
    await t.run((ctx) => ctx.db.insert("brand_decisions", { spaceId, field: "primary", candidates: [], recommended: "#000000", recommendedSource: "heuristic", chosen: "#000000", accepted: true, companyProfile: { host: "acme.com", paletteSummary: "" }, features: [], chosenFeatures: {}, featureVersion: 1, tokensVersion: 1, actor: "user:x" }));
    expect(await mgr.query(api.scans.nextStep, { spaceId })).toBeNull();
  });
});
