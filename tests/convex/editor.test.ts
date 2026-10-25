// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const owner = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await owner.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  return { t, owner, spaceId };
}

describe("editor read model", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("flags the step teaching a fact whose Slack source changed, naming the source", async () => {
    const { t, owner, spaceId } = await setup();
    const connectorId = await t.mutation(api.ingest.ensureConnector, { secret, spaceId, type: "slack" });
    const upsert = (hash: string) =>
      t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "message", externalId: "C1/171", title: "#eng-announcements", contentHash: hash });
    const { sourceItemId } = await upsert("h1");
    const { courseId } = await t.run(async (ctx) => {
      const chunkId = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId, version: 1, idx: 0, text: "Deploys on Tuesdays", tokens: 4 });
      const factId = await ctx.db.insert("facts", { spaceId, category: "Rituals", text: "Deploys on Tuesdays", confidence: 0.95, sourceChunkIds: [chunkId], status: "approved", createdBy: "agent", version: 1 });
      await ctx.db.insert("fact_citations", { spaceId, factId, chunkId, sourceItemId });
      const spec = {
        title: "Tools & Stack",
        icon: "wrench",
        building: "Workshop",
        game: "road",
        steps: [
          { id: "welcome", kind: "welcome", title: "Welcome", teaches_fact_ids: [] },
          { id: "deploys", kind: "lesson", title: "Ship to prod", body: "Deploys on Tuesdays", teaches_fact_ids: [factId] },
          { id: "done", kind: "done", title: "Done", teaches_fact_ids: [] },
        ],
      };
      const courseId = await ctx.db.insert("courses", { spaceId, packType: "tools", title: "Tools & Stack", icon: "wrench", building: "Workshop", game: "road", spec, status: "draft", needsRefresh: false, version: 3 });
      await ctx.db.insert("course_facts", { spaceId, courseId, factId, stepId: "deploys" });
      return { courseId };
    });

    const before = await owner.query(api.editor.load, { spaceId });
    expect(before.course).toMatchObject({ _id: courseId, version: 3, staleSteps: {} });

    await upsert("h2"); // the Slack message changed → fact stale → step needs refresh
    const after = await owner.query(api.editor.load, { spaceId, courseId });
    expect(after.course?.staleSteps).toEqual({ deploys: [{ type: "slack", title: "#eng-announcements" }] });
  });

  it("lists scraped logos and asset items with where they were found", async () => {
    const { t, owner, spaceId } = await setup();
    await t.run(async (ctx) => {
      const brandId = await ctx.db.insert("brand_profiles", {
        spaceId,
        tokensVersion: 1,
        palette: [{ name: "Primary", hex: "#123456", role: "primary" }],
        typography: { heading: { family: "Inter" }, body: { family: "Inter" }, notes: "" },
        logoRefs: [{ kind: "mark", url: "https://acme.com/logo.svg", format: "svg" }],
        voice: "Plain and direct",
      });
      await ctx.db.patch(spaceId, { brandProfileId: brandId });
      await ctx.db.insert("source_items", { spaceId, kind: "asset", externalId: "hero", url: "https://acme.com/hero.jpg", title: "Hero image", meta: { foundOn: "https://acme.com/" }, contentHash: "x", version: 1, fetchedAt: 1 });
      await ctx.db.insert("source_items", { spaceId, kind: "page", externalId: "p", url: "https://acme.com/", title: "Home", contentHash: "y", version: 1, fetchedAt: 1 });
    });
    const { assets } = await owner.query(api.editor.assets, { spaceId });
    expect(assets.find((a) => a.name === "Logo mark")).toMatchObject({ category: "brand", foundAt: "https://acme.com/logo.svg", thumb: { image: "https://acme.com/logo.svg" } });
    expect(assets.find((a) => a.name === "Hero image")).toMatchObject({ foundAt: "https://acme.com/", thumb: { image: "https://acme.com/hero.jpg" } });
    expect(assets.some((a) => a.name === "Home")).toBe(false);
  });

  it("is manager-only", async () => {
    const { t, spaceId } = await setup();
    const strangerId = await t.run((ctx) => ctx.db.insert("users", { email: "x@y.z" }));
    await expect(t.withIdentity({ subject: `${strangerId}|s` }).query(api.editor.load, { spaceId })).rejects.toThrow(/access/);
  });
});
