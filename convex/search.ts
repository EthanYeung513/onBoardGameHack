import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery } from "./_generated/server";
import { MANAGERS, requireRole } from "./lib/access";
import { EMBEDDING_DIMS } from "./schema";

// Brain search (F17): hybrid = BM25 over `doc_chunks.search_text` + vector search over
// `doc_chunks.by_embedding` (actions only), fused by reciprocal rank, plus matching facts and a
// 1-hop expansion over `edges` from the entities those chunks mention. Every result carries citations.
// The query vector comes from the caller (GET /api/brain/search embeds `q` with the worker's
// embedder so it matches the stored vectors); without it the search is lexical + graph, and says so.

const RRF_K = 60;

export const authorize = internalQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    return true;
  },
});

/** Search queries are capped at 16 terms. */
const terms = (q: string) => q.trim().split(/\s+/).slice(0, 16).join(" ");

export const lexical = internalQuery({
  args: { spaceId: v.id("spaces"), q: v.string(), limit: v.number() },
  handler: async (ctx, { spaceId, q, limit }) => {
    const chunks = await ctx.db
      .query("doc_chunks")
      .withSearchIndex("search_text", (s) => s.search("text", terms(q)).eq("spaceId", spaceId))
      .take(limit * 2);
    const facts = await ctx.db
      .query("facts")
      .withSearchIndex("search_text", (s) => s.search("text", terms(q)).eq("spaceId", spaceId))
      .take(limit * 2);
    return {
      chunkIds: chunks.map((c) => c._id),
      factIds: facts.filter((f) => f.status !== "rejected").map((f) => f._id),
    };
  },
});

type Hydrated = {
  results: { chunkId: Id<"doc_chunks">; score?: number; snippet: string; source: { title: string; url: string | null; kind: string; connectorType: string }; factIds: Id<"facts">[] }[];
  facts: { id: Id<"facts">; text: string; category: string; status: string; confidence: number; entityId: Id<"entities"> | null; citations: { chunkId: Id<"doc_chunks">; title: string; url: string | null }[] }[];
  entities: { id: Id<"entities">; name: string; type: string; hop: 0 | 1; via?: { relation: string; from: Id<"entities"> } }[];
};

export const hydrate = internalQuery({
  args: { spaceId: v.id("spaces"), chunkIds: v.array(v.id("doc_chunks")), factIds: v.array(v.id("facts")) },
  handler: async (ctx, { spaceId, chunkIds, factIds }): Promise<Hydrated> => {
    const factDocs = new Map<Id<"facts">, Doc<"facts">>();
    const seeds = new Set<Id<"entities">>();
    const results: Hydrated["results"] = [];
    for (const chunkId of chunkIds) {
      const chunk = await ctx.db.get(chunkId);
      if (!chunk || chunk.spaceId !== spaceId) continue;
      const item = await ctx.db.get(chunk.sourceItemId);
      // Superseded versions keep their text for provenance but are not search results.
      if (!item || item.removedAt || item.version !== chunk.version) continue;
      const connector = item.connectorId ? await ctx.db.get(item.connectorId) : null;
      const cites = await ctx.db.query("fact_citations").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).take(20);
      const ids: Id<"facts">[] = [];
      for (const c of cites) {
        const f = await ctx.db.get(c.factId);
        if (!f || f.status === "rejected") continue;
        factDocs.set(f._id, f);
        ids.push(f._id);
      }
      for (const m of await ctx.db.query("entity_mentions").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).take(20)) seeds.add(m.entityId);
      results.push({ chunkId, snippet: chunk.text.slice(0, 400), source: { title: item.title, url: item.url ?? null, kind: item.kind, connectorType: connector?.type ?? "manual" }, factIds: ids });
    }
    for (const id of factIds) {
      const f = await ctx.db.get(id);
      if (f && f.spaceId === spaceId && f.status !== "rejected") factDocs.set(id, f);
    }
    for (const f of factDocs.values()) if (f.entityId) seeds.add(f.entityId);

    const entities: Hydrated["entities"] = [];
    const seen = new Set<Id<"entities">>();
    for (const id of [...seeds].slice(0, 12)) {
      const e = await ctx.db.get(id);
      if (!e || e.mergedInto || seen.has(id)) continue;
      seen.add(id);
      entities.push({ id, name: e.name, type: e.type, hop: 0 });
    }
    // 1-hop expansion: neighbours of the seed entities, and a few of their facts.
    for (const seed of entities.slice()) {
      const out = await ctx.db.query("edges").withIndex("by_source", (q) => q.eq("sourceId", seed.id)).take(10);
      const inc = await ctx.db.query("edges").withIndex("by_target", (q) => q.eq("targetId", seed.id)).take(10);
      for (const edge of [...out, ...inc]) {
        const other = edge.sourceId === seed.id ? edge.targetId : edge.sourceId;
        if (seen.has(other)) continue;
        const e = await ctx.db.get(other);
        if (!e || e.mergedInto) continue;
        seen.add(other);
        entities.push({ id: other, name: e.name, type: e.type, hop: 1, via: { relation: edge.relation, from: seed.id } });
        for (const f of await ctx.db.query("facts").withIndex("by_entity", (q) => q.eq("entityId", other)).take(3)) {
          if (f.status === "approved") factDocs.set(f._id, f);
        }
      }
      if (entities.length > 30) break;
    }

    const facts: Hydrated["facts"] = [];
    for (const f of factDocs.values()) {
      const citations: Hydrated["facts"][number]["citations"] = [];
      for (const chunkId of f.sourceChunkIds.slice(-3)) {
        const chunk = await ctx.db.get(chunkId);
        const item = chunk ? await ctx.db.get(chunk.sourceItemId) : null;
        citations.push({ chunkId, title: item?.title ?? "", url: item?.url ?? null });
      }
      facts.push({ id: f._id, text: f.text, category: f.category, status: f.status, confidence: f.confidence, entityId: f.entityId ?? null, citations });
    }
    return { results, facts: facts.slice(0, 30), entities };
  },
});

export const search = action({
  args: { spaceId: v.id("spaces"), q: v.string(), vector: v.optional(v.array(v.float64())), limit: v.optional(v.number()) },
  handler: async (ctx, { spaceId, q, vector, limit }): Promise<Hydrated & { query: string; modes: { lexical: boolean; vector: boolean; graph: boolean } }> => {
    await ctx.runQuery(internal.search.authorize, { spaceId });
    const n = Math.max(1, Math.min(limit ?? 8, 25));
    const query = q.trim().slice(0, 300);
    if (!query) return { query, modes: { lexical: false, vector: false, graph: false }, results: [], facts: [], entities: [] };
    const lex: { chunkIds: Id<"doc_chunks">[]; factIds: Id<"facts">[] } = await ctx.runQuery(internal.search.lexical, { spaceId, q: query, limit: n });
    const useVector = vector?.length === EMBEDDING_DIMS;
    const vec = useVector ? await ctx.vectorSearch("doc_chunks", "by_embedding", { vector: vector!, limit: n * 2, filter: (f) => f.eq("spaceId", spaceId) }) : [];
    const score = new Map<Id<"doc_chunks">, number>();
    lex.chunkIds.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (RRF_K + i + 1)));
    vec.forEach((h, i) => score.set(h._id, (score.get(h._id) ?? 0) + 1 / (RRF_K + i + 1)));
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    const hydrated: Hydrated = await ctx.runQuery(internal.search.hydrate, { spaceId, chunkIds: ranked.map(([id]) => id), factIds: lex.factIds.slice(0, n) });
    const byId = new Map(ranked);
    return {
      query,
      modes: { lexical: true, vector: useVector, graph: true },
      ...hydrated,
      results: hydrated.results.map((r) => ({ ...r, score: byId.get(r.chunkId) ?? 0 })),
    };
  },
});
