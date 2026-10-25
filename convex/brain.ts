import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { type Category, partitionOf, PARTITIONS, seededPosition, TYPE_PARTITION } from "./lib/partitions";

// Read side of the company brain (PRD F18, BUILD-CONTRACT "Brain contract"): the knowledge graph
// for the brain page / cosmos.gl, one entity's provenance for the side panel, and partition counts
// for the legend and caption. Merged entities are folded into their canonical entity; rejected
// facts never leave this file.

export type GraphNode = {
  id: Id<"entities">;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  cluster: Category;
  type: Doc<"entities">["type"];
  /** Visible facts whose source changed since extraction (F35) — the page outlines these nodes. */
  stale: number;
};
export type GraphEdge = { source: Id<"entities">; target: Id<"entities">; relation: Doc<"edges">["relation"] };
export type BrainGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

const visible = (f: Doc<"facts">) => f.status !== "rejected";

/** Majority category of an entity's visible facts; ties keep partition order. Falls back to its type. */
function clusterFor(entity: Doc<"entities">, facts: Doc<"facts">[]): Category {
  if (!facts.length) return TYPE_PARTITION[entity.type];
  const tally = new Map<Category, number>();
  for (const f of facts) tally.set(f.category, (tally.get(f.category) ?? 0) + 1);
  let best: Category = facts[0].category;
  for (const p of PARTITIONS) if ((tally.get(p.name) ?? 0) > (tally.get(best) ?? 0)) best = p.name;
  return best;
}

async function spaceFacts(ctx: QueryCtx, spaceId: Id<"spaces">) {
  const all = await ctx.db
    .query("facts")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .collect();
  return all.filter(visible);
}

/** Follow `mergedInto` to the canonical entity id (bounded, in case of a bad chain). */
function canonicalId(byId: Map<Id<"entities">, Doc<"entities">>, id: Id<"entities">): Id<"entities"> | null {
  let cur = byId.get(id);
  for (let hops = 0; cur?.mergedInto && hops < 8; hops++) cur = byId.get(cur.mergedInto);
  return cur && !cur.mergedInto ? cur._id : null;
}

export const graph = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }): Promise<BrainGraph> => {
    await requireRole(ctx, spaceId, MANAGERS);
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
      .collect();
    const byId = new Map(entities.map((e) => [e._id, e]));
    const facts = await spaceFacts(ctx, spaceId);
    const factsBy = new Map<Id<"entities">, Doc<"facts">[]>();
    for (const f of facts) {
      const owner = f.entityId && canonicalId(byId, f.entityId);
      if (owner) factsBy.set(owner, [...(factsBy.get(owner) ?? []), f]);
    }

    const nodes: GraphNode[] = [];
    for (const e of entities) {
      if (e.mergedInto) continue;
      const mentions = await ctx.db
        .query("entity_mentions")
        .withIndex("by_entity", (q) => q.eq("entityId", e._id))
        .collect();
      const own = factsBy.get(e._id) ?? [];
      const p = partitionOf(clusterFor(e, own));
      const { x, y } = seededPosition(e._id, p);
      nodes.push({ id: e._id, label: e.name, x, y, size: mentions.length + own.length, color: p.color, cluster: p.name, type: e.type, stale: own.filter((f) => f.status === "stale").length });
    }

    const rawEdges = await ctx.db
      .query("edges")
      .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
      .collect();
    const seen = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const r of rawEdges) {
      const source = canonicalId(byId, r.sourceId);
      const target = canonicalId(byId, r.targetId);
      if (!source || !target || source === target) continue;
      const key = `${source}|${target}|${r.relation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target, relation: r.relation });
    }
    return { nodes, edges };
  },
});

const SNIPPET = 280;

export const entity = query({
  args: { spaceId: v.id("spaces"), entityId: v.id("entities") },
  handler: async (ctx, { spaceId, entityId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    let e = await ctx.db.get(entityId);
    for (let hops = 0; e?.mergedInto && hops < 8; hops++) e = await ctx.db.get(e.mergedInto);
    if (!e || e.spaceId !== spaceId || e.mergedInto) fail(404, "Entity not found");

    // The canonical entity plus everything merged into it (same set the graph node counts).
    const all = await ctx.db
      .query("entities")
      .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
      .collect();
    const byId = new Map(all.map((x) => [x._id, x]));
    const members = all.filter((x) => canonicalId(byId, x._id) === e._id);
    const rows = (
      await Promise.all(
        members.map((m) =>
          ctx.db
            .query("facts")
            .withIndex("by_entity", (q) => q.eq("entityId", m._id))
            .collect(),
        ),
      )
    )
      .flat()
      .filter(visible);
    const facts = await Promise.all(
      rows.map(async (f) => {
        const citations = [];
        for (const chunkId of f.sourceChunkIds) {
          const chunk = await ctx.db.get(chunkId);
          if (!chunk || chunk.spaceId !== spaceId) continue;
          const source = await ctx.db.get(chunk.sourceItemId);
          const connector = source?.connectorId ? await ctx.db.get(source.connectorId) : null;
          const text = chunk.text.replace(/\s+/g, " ").trim();
          citations.push({
            chunkId,
            snippet: text.length > SNIPPET ? `${text.slice(0, SNIPPET - 1)}…` : text,
            title: source?.title ?? "Unknown source",
            url: source?.url ?? null,
            kind: source?.kind ?? null,
            connector: connector?.type ?? null,
            /** The cited source has a newer version than this chunk, or was removed. */
            changed: !source || source.removedAt !== undefined || source.version > chunk.version,
          });
        }
        return {
          id: f._id,
          text: f.text,
          category: f.category,
          confidence: f.confidence,
          status: f.status as Exclude<Doc<"facts">["status"], "rejected">,
          citations,
        };
      }),
    );
    // Stale first: the self-updating brain is the thing to see (source changed → fact needs re-checking).
    const order = { stale: 0, approved: 1, draft: 2 } as const;
    facts.sort((a, b) => order[a.status] - order[b.status] || b.confidence - a.confidence);
    const p = partitionOf(clusterFor(e, rows));
    return { id: e._id, name: e.name, type: e.type, aliases: e.aliases, cluster: p.name, color: p.color, facts };
  },
});

export const stats = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const [entities, allFacts, edges, connectors] = await Promise.all([
      ctx.db
        .query("entities")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .collect(),
      ctx.db
        .query("facts")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .collect(),
      ctx.db
        .query("edges")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .collect(),
      ctx.db
        .query("connectors")
        .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
        .collect(),
    ]);
    const facts = allFacts.filter(visible);
    const live = entities.filter((e) => !e.mergedInto);
    const byId = new Map(entities.map((e) => [e._id, e]));
    const factsBy = new Map<Id<"entities">, Doc<"facts">[]>();
    for (const f of facts) {
      const owner = f.entityId && canonicalId(byId, f.entityId);
      if (owner) factsBy.set(owner, [...(factsBy.get(owner) ?? []), f]);
    }

    const clusters = PARTITIONS.map((p) => ({
      name: p.name,
      color: p.color,
      entities: 0,
      facts: { approved: 0, draft: 0, stale: 0 },
    }));
    for (const e of live) clusters.find((c) => c.name === clusterFor(e, factsBy.get(e._id) ?? []))!.entities++;
    for (const f of facts) clusters.find((c) => c.name === f.category)!.facts[f.status as "approved" | "draft" | "stale"]++;

    const website = await ctx.db
      .query("scans")
      .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
      .first();
    const lastUpdated = Math.max(0, ...entities.map((e) => e._creationTime), ...allFacts.map((f) => f._creationTime), ...edges.map((e) => e._creationTime));
    return {
      clusters,
      entities: live.length,
      facts: facts.length,
      connectedTools: connectors.filter((c) => c.type !== "website" && c.status === "ready").length,
      websiteScanned: website !== null,
      lastUpdated: lastUpdated || null,
    };
  },
});
