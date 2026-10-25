// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const { spaceId } = await t.withIdentity({ subject: `${userId}|s` }).mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  const connectorId = await t.mutation(api.ingest.ensureConnector, { secret, spaceId, type: "github" });
  const upsert = (externalId: string, hash: string) =>
    t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "doc", externalId, title: externalId, contentHash: hash });
  return { t, spaceId, connectorId, upsert };
}

/** A fact citing the item's first chunk, taught by one course. */
async function factWithCourse(t: Awaited<ReturnType<typeof setup>>["t"], spaceId: Id<"spaces">, sourceItemId: Id<"source_items">) {
  return t.run(async (ctx) => {
    const chunkId = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId, version: 1, idx: 0, text: "Deploys happen on Tuesdays", tokens: 6 });
    const factId = await ctx.db.insert("facts", { spaceId, category: "Rituals", text: "Deploys happen on Tuesdays", confidence: 0.95, sourceChunkIds: [chunkId], status: "approved", createdBy: "agent", version: 1 });
    await ctx.db.insert("fact_citations", { spaceId, factId, chunkId, sourceItemId });
    const courseId = await ctx.db.insert("courses", { spaceId, packType: "company", title: "Company", icon: "🏢", building: "hq", game: "quiz", spec: {}, status: "published", needsRefresh: false, version: 1 });
    await ctx.db.insert("course_facts", { spaceId, courseId, factId });
    return { factId, courseId };
  });
}

describe("ingest + drift cascade (F34–F36)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("emits added → unchanged → changed, and a change marks citing facts stale and courses needs_refresh", async () => {
    const { t, spaceId, upsert } = await setup();
    const a = await upsert("README.md", "h1");
    expect(a).toMatchObject({ status: "added", version: 1 });
    const { factId, courseId } = await factWithCourse(t, spaceId, a.sourceItemId);
    expect(await upsert("README.md", "h1")).toMatchObject({ status: "unchanged", version: 1 });
    expect(await upsert("README.md", "h2")).toMatchObject({ status: "changed", version: 2, staleFacts: 1 });

    const [fact, course, diffs, audits] = await t.run(async (ctx) => [
      await ctx.db.get(factId),
      await ctx.db.get(courseId),
      await ctx.db.query("diff_events").collect(),
      await ctx.db.query("audit_events").collect(),
    ] as const);
    expect(fact).toMatchObject({ status: "stale", version: 2 });
    expect(course?.needsRefresh).toBe(true);
    expect(diffs.map((d) => d.kind)).toEqual(["added", "changed"]);
    expect(audits.map((e) => e.kind)).toEqual(expect.arrayContaining(["fact.stale", "course.needs_refresh"]));
  });

  it("writes chunks idempotently per version and ignores batches for a superseded version", async () => {
    const { t, upsert } = await setup();
    const a = await upsert("doc", "h1");
    const chunk = { idx: 0, text: "hello", tokens: 2, embedding: new Array(1536).fill(0.01) };
    expect(await t.mutation(api.ingest.addChunks, { secret, sourceItemId: a.sourceItemId, version: 1, chunks: [chunk] })).toMatchObject({ written: 1 });
    expect(await t.mutation(api.ingest.addChunks, { secret, sourceItemId: a.sourceItemId, version: 1, chunks: [chunk] })).toMatchObject({ written: 0 });
    await upsert("doc", "h2");
    expect(await t.mutation(api.ingest.addChunks, { secret, sourceItemId: a.sourceItemId, version: 1, chunks: [chunk] })).toMatchObject({ superseded: true });
    const old = await t.run((ctx) => ctx.db.query("doc_chunks").collect());
    expect(old[0].embedding).toBeUndefined(); // retired from vector search, text kept for provenance
  });

  it("sweeps items a full sync no longer saw as removed", async () => {
    const { t, spaceId, connectorId, upsert } = await setup();
    const keep = await upsert("keep", "k");
    const gone = await upsert("gone", "g");
    const { factId } = await factWithCourse(t, spaceId, gone.sourceItemId);
    await new Promise((r) => setTimeout(r, 5));
    const syncStart = Date.now();
    await upsert("keep", "k");
    expect(await t.mutation(api.ingest.sweepRemoved, { secret, spaceId, connectorId, before: syncStart })).toEqual({ removed: 1 });
    const [k, g, f] = await t.run(async (ctx) => [await ctx.db.get(keep.sourceItemId), await ctx.db.get(gone.sourceItemId), await ctx.db.get(factId)] as const);
    expect(k?.removedAt).toBeUndefined();
    expect(g?.removedAt).toBeTypeOf("number");
    expect(f?.status).toBe("stale");
  });
});
