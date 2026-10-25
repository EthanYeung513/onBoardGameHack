// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => {
    const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
    return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
  };
  const owner = await user("dana@acme.com");
  const { spaceId } = await owner.as.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });

  // Slack message → chunk → GitHub entity (approved + draft + rejected + stale facts), a merged duplicate.
  const ids = await t.run(async (ctx) => {
    const connectorId = await ctx.db.insert("connectors", { spaceId, type: "slack", status: "ready" });
    const src = await ctx.db.insert("source_items", {
      spaceId,
      connectorId,
      kind: "message",
      externalId: "m1",
      url: "https://acme.slack.com/archives/C1/p1",
      title: "#eng thread",
      contentHash: "h",
      version: 2,
      fetchedAt: 0,
    });
    const chunk = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId: src, version: 1, idx: 0, text: "We ship from GitHub   main.", tokens: 5 });
    const entity = (name: string, type: "tool" | "person", mergedInto?: Id<"entities">) =>
      ctx.db.insert("entities", { spaceId, type, name, key: name.toLowerCase(), aliases: ["gh"], version: 1, mergedInto });
    const github = await entity("GitHub", "tool");
    const marco = await entity("Marco", "person");
    const dup = await entity("Github dup", "tool", github);
    await ctx.db.insert("entity_mentions", { spaceId, entityId: github, chunkId: chunk, span: { start: 0, end: 6 }, confidence: 1 });
    const fact = (entityId: Id<"entities">, text: string, status: "approved" | "draft" | "rejected" | "stale") =>
      ctx.db.insert("facts", { spaceId, entityId, category: "Tools", text, confidence: 0.8, sourceChunkIds: [chunk], status, createdBy: "agent", version: 1 });
    await fact(github, "Code lives on GitHub", "approved");
    await fact(github, "Maybe GitLab too", "draft");
    await fact(github, "GitHub is for docs", "rejected");
    await fact(dup, "main is protected", "stale");
    await ctx.db.insert("edges", { spaceId, sourceId: marco, targetId: dup, relation: "uses", version: 1 });
    await ctx.db.insert("edges", { spaceId, sourceId: marco, targetId: github, relation: "uses", version: 1 });
    return { github, marco, dup };
  });
  return { t, user, owner, spaceId, ...ids };
}

describe("brain read side", () => {
  it("graph folds merged entities into their canonical node and hides rejected facts", async () => {
    const { owner, spaceId, github, marco } = await setup();
    const g = await owner.as.query(api.brain.graph, { spaceId });
    expect(g.nodes.map((n) => n.label).sort()).toEqual(["GitHub", "Marco"]);
    const gh = g.nodes.find((n) => n.id === github)!;
    // 1 mention + approved + draft + the merged duplicate's stale fact; rejected doesn't count.
    expect(gh).toMatchObject({ cluster: "Tools", color: "#34c98e", size: 4, stale: 1, type: "tool" });
    expect(g.nodes.find((n) => n.id === marco)).toMatchObject({ cluster: "People", size: 0 });
    // Both edges point at GitHub after folding, and collapse to one.
    expect(g.edges).toEqual([{ source: marco, target: github, relation: "uses" }]);
    // Seeded layout is stable.
    expect((await owner.as.query(api.brain.graph, { spaceId })).nodes).toEqual(g.nodes);
  });

  it("entity returns provenance with citations; draft and stale marked, rejected never shown", async () => {
    const { owner, spaceId, github, dup } = await setup();
    const e = await owner.as.query(api.brain.entity, { spaceId, entityId: github });
    expect(e.aliases).toEqual(["gh"]);
    // Stale first (incl. the merged duplicate's fact), then approved, then draft.
    expect(e.facts.map((f) => [f.status, f.text])).toEqual([
      ["stale", "main is protected"],
      ["approved", "Code lives on GitHub"],
      ["draft", "Maybe GitLab too"],
    ]);
    expect(e.facts[1].citations[0]).toMatchObject({
      snippet: "We ship from GitHub main.",
      title: "#eng thread",
      url: "https://acme.slack.com/archives/C1/p1",
      kind: "message",
      connector: "slack",
      changed: true,
    });
    // A merged id resolves to the canonical entity.
    expect((await owner.as.query(api.brain.entity, { spaceId, entityId: dup })).id).toBe(github);
  });

  it("stats counts per partition and status", async () => {
    const { owner, spaceId } = await setup();
    const s = await owner.as.query(api.brain.stats, { spaceId });
    expect(s.clusters.find((c) => c.name === "Tools")).toMatchObject({ entities: 1, facts: { approved: 1, draft: 1, stale: 1 } });
    expect(s).toMatchObject({ entities: 2, facts: 3, connectedTools: 1, websiteScanned: false });
  });

  it("rejects outsiders, hires and cross-space entity lookups", async () => {
    const { t, user, spaceId, github } = await setup();
    const eve = await user("eve@evil.com");
    await expect(eve.as.query(api.brain.graph, { spaceId })).rejects.toThrow(/403/);
    await expect(eve.as.query(api.brain.entity, { spaceId, entityId: github })).rejects.toThrow(/403/);
    await expect(t.query(api.brain.stats, { spaceId })).rejects.toThrow(/401/);
    const hire = await user("hire@acme.com");
    await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: hire.userId, role: "hire" }));
    await expect(hire.as.query(api.brain.graph, { spaceId })).rejects.toThrow(/403/);
    // Eve's own space can't be used to read Acme's entity.
    const { spaceId: evil } = await eve.as.mutation(api.spaces.create, { name: "Evil", website: "evil.com" });
    await expect(eve.as.query(api.brain.entity, { spaceId: evil, entityId: github })).rejects.toThrow(/404/);
    expect(await eve.as.query(api.brain.graph, { spaceId: evil })).toEqual({ nodes: [], edges: [] });
  });
});
