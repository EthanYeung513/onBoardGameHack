import { v, type ObjectType } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { factKey, hardKeys, normName } from "../src/lib/brain/normalize";
import { addCitation, canonical, entityKeys, findByHardKeys, statusFor, upsertFact, type FactOutcome, type HardKeyCache } from "./lib/brainWrite";
import { fail } from "./lib/errors";
import { workerAction, workerMutation, workerQuery } from "./lib/worker";
import { describeSource } from "./ingest";
import { entityType, factCategory, relation } from "./schema";

// Worker side of the company brain (S8/F14/F15/F35): the `seed_brain` stage reads unextracted
// chunks and commits one chunk's extraction at a time; the `cascade` stage walks `diff_events`.
// The manager read side (graph, entity panel) is convex/brain.ts; review is convex/facts.ts.

async function chunkView(ctx: QueryCtx, c: Doc<"doc_chunks">) {
  const item = await ctx.db.get(c.sourceItemId);
  const connector = item?.connectorId ? await ctx.db.get(item.connectorId) : null;
  const obsolete = !item || Boolean(item.removedAt) || item.version !== c.version;
  return { id: c._id, text: c.text, sourceItemId: c.sourceItemId, title: item?.title ?? "", kind: item?.kind ?? "doc", connectorType: connector?.type ?? "manual", obsolete };
}

/** Chunks still waiting for extraction — the whole space, or one source item's current version. */
export const pendingChunks = workerQuery({
  args: { spaceId: v.id("spaces"), sourceItemId: v.optional(v.id("source_items")), limit: v.number() },
  handler: async (ctx, { spaceId, sourceItemId, limit }) => {
    let chunks: Doc<"doc_chunks">[];
    if (sourceItemId) {
      const item = await ctx.db.get(sourceItemId);
      if (!item || item.spaceId !== spaceId || item.removedAt) return [];
      chunks = (
        await ctx.db
          .query("doc_chunks")
          .withIndex("by_source_version", (q) => q.eq("sourceItemId", sourceItemId).eq("version", item.version))
          .collect()
      ).filter((c) => !c.extractedAt);
    } else {
      chunks = await ctx.db
        .query("doc_chunks")
        .withIndex("by_space_extracted", (q) => q.eq("spaceId", spaceId).eq("extractedAt", undefined))
        .take(limit);
    }
    return await Promise.all(chunks.slice(0, limit).map((c) => chunkView(ctx, c)));
  },
});

/** How many chunks are left (progress) — capped so the count stays cheap. */
/** Chunks read to count pending work. Each carries a ~12 KB embedding: keep well under the 16 MB read limit (#28). */
export const PENDING_COUNT_CAP = 300;

export const pendingCount = workerQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) =>
    (await ctx.db.query("doc_chunks").withIndex("by_space_extracted", (q) => q.eq("spaceId", spaceId).eq("extractedAt", undefined)).take(PENDING_COUNT_CAP)).length,
});

/** Previously rejected facts: negative examples for the extraction prompt (F16). */
export const rejectedExamples = workerQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) =>
    (
      await ctx.db
        .query("facts")
        .withIndex("by_space_status", (q) => q.eq("spaceId", spaceId).eq("status", "rejected"))
        .order("desc")
        .take(30)
    ).map((f) => f.text),
});

const keysV = v.object({ email: v.optional(v.string()), login: v.optional(v.string()), url: v.optional(v.string()) });
const candidateV = v.object({ type: entityType, name: v.string(), aliases: v.array(v.string()), keys: keysV });

/** F15 step 1: hard keys (email, login, URL, normalised name) → existing entity, without the LLM. */
export const matchHardKeys = workerQuery({
  args: { spaceId: v.id("spaces"), items: v.array(candidateV) },
  handler: async (ctx, { spaceId, items }) => {
    const out: ({ id: Id<"entities">; name: string; key: string } | null)[] = [];
    const cache: HardKeyCache = new Map();
    for (const it of items) {
      const hit = await findByHardKeys(ctx, spaceId, it.type, it, cache);
      out.push(hit ? { id: hit.entity._id, name: hit.entity.name, key: hit.key } : null);
    }
    return out;
  },
});

export const entitiesByIds = internalQuery({
  args: { ids: v.array(v.id("entities")) },
  handler: async (ctx, { ids }) => (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((e): e is Doc<"entities"> => e !== null),
});

/** F15 step 2: embedding top-k over `entities.by_embedding` (vector search is action-only). */
export const similarEntities = workerAction({
  args: { spaceId: v.id("spaces"), type: entityType, vector: v.array(v.float64()), k: v.number() },
  handler: async (ctx, { spaceId, type, vector, k }): Promise<{ id: Id<"entities">; name: string; aliases: string[]; score: number }[]> => {
    const hits = await ctx.vectorSearch("entities", "by_embedding", { vector, limit: Math.min(64, k * 4), filter: (q) => q.eq("spaceId", spaceId) });
    const docs: Doc<"entities">[] = await ctx.runQuery(internal.brainWorker.entitiesByIds, { ids: hits.map((h) => h._id) });
    const byId = new Map(docs.map((d) => [d._id, d]));
    return hits
      .map((h) => ({ h, d: byId.get(h._id) }))
      .filter(({ d }) => d && d.type === type && !d.mergedInto)
      .slice(0, k)
      .map(({ h, d }) => ({ id: h._id, name: d!.name, aliases: d!.aliases, score: h._score }));
  },
});

const decisionV = v.object({
  method: v.union(v.literal("hard_key"), v.literal("embedding"), v.literal("llm"), v.literal("new")),
  score: v.optional(v.number()),
  reason: v.optional(v.string()),
  candidateId: v.optional(v.id("entities")),
  mode: v.optional(v.union(v.literal("live"), v.literal("offline"))),
});

function mentionSpan(text: string, names: string[]) {
  const lower = text.toLowerCase();
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase());
    if (i >= 0) return { start: i, end: i + n.length };
  }
  return { start: 0, end: 0 };
}

/**
 * Commit one chunk's extraction: resolved entities (version bumps on merge), mentions, edges, facts
 * (dedupe + citations + threshold), then `extractedAt`. Idempotent: an already-extracted chunk is a no-op.
 */
const commitArgs = {
  spaceId: v.id("spaces"),
  chunkId: v.id("doc_chunks"),
  mode: v.union(v.literal("live"), v.literal("offline")),
  model: v.string(),
  actor: v.optional(v.string()),
  entities: v.array(v.object({ ...candidateV.fields, match: v.optional(v.id("entities")), decision: decisionV, embedding: v.optional(v.array(v.float64())) })),
  edges: v.array(v.object({ source: v.number(), target: v.number(), relation, evidence: v.string(), rule: v.optional(v.string()) })),
  facts: v.array(
    v.object({ category: factCategory, text: v.string(), entity: v.optional(v.number()), confidence: v.number(), span: v.object({ start: v.number(), end: v.number() }) }),
  ),
};

type CommitArgs = ObjectType<typeof commitArgs>;

/** One chunk's extraction → entities, mentions, edges, facts (+ citations), `extractedAt`. */
async function commitOne(ctx: MutationCtx, a: CommitArgs, hardKeyCache: HardKeyCache = new Map()) {
    const chunk = await ctx.db.get(a.chunkId);
    if (!chunk || chunk.spaceId !== a.spaceId) return fail(404, "Chunk not found");
    if (chunk.extractedAt) return { skipped: true as const };
    const space = await ctx.db.get(a.spaceId);
    const item = await ctx.db.get(chunk.sourceItemId);
    if (!space) return fail(404, "Space not found");
    const now = Date.now();
    if (!item || item.removedAt || item.version !== chunk.version) {
      await ctx.db.patch(chunk._id, { extractedAt: now });
      return { skipped: true as const, obsolete: true };
    }
    const actor = a.actor ?? "agent:seed_brain";
    const ids: Id<"entities">[] = [];
    let created = 0;
    let merged = 0;
    for (const e of a.entities) {
      let target = e.match ? await canonical(ctx, e.match) : null;
      let method = e.decision.method;
      let reason = e.decision.reason;
      if (!target || target.spaceId !== a.spaceId || target.type !== e.type) {
        target = null;
        const hk = await findByHardKeys(ctx, a.spaceId, e.type, e, hardKeyCache);
        if (hk) {
          target = hk.entity;
          method = "hard_key";
          reason = `shares ${hk.key}`;
        }
      }
      const candKeys = hardKeys(e);
      let id: Id<"entities">;
      if (target) {
        id = target._id;
        const known = new Set([target.name, ...target.aliases].map(normName));
        const aliases = [...target.aliases];
        for (const n of [e.name, ...e.aliases]) {
          if (known.has(normName(n))) continue;
          known.add(normName(n));
          aliases.push(n);
        }
        const before = entityKeys(target);
        const keys = [...new Set([...before, ...candKeys])];
        if (aliases.length !== target.aliases.length || keys.length !== before.length) {
          await ctx.db.patch(id, { aliases, fields: { ...(target.fields ?? {}), keys }, version: target.version + 1, ...(target.embedding ? {} : { embedding: e.embedding }) });
        }
        merged++;
      } else {
        const aliases = [...new Set(e.aliases.filter((n) => normName(n) !== normName(e.name)))];
        id = await ctx.db.insert("entities", {
          spaceId: a.spaceId,
          type: e.type,
          name: e.name,
          key: candKeys[0] ?? `name:${normName(e.name)}`,
          aliases,
          fields: { keys: candKeys },
          version: 1,
          embedding: e.embedding,
        });
        created++;
      }
      ids.push(id);
      await ctx.db.insert("audit_events", {
        spaceId: a.spaceId,
        actor,
        kind: "entity.resolved",
        payload: { entityId: id, name: e.name, type: e.type, decision: target ? "matched" : "created", method: target ? method : "new", score: e.decision.score, reason, candidateId: e.decision.candidateId, adjudication: e.decision.mode, chunkId: chunk._id, mode: a.mode },
      });
      const already = await ctx.db
        .query("entity_mentions")
        .withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id))
        .filter((q) => q.eq(q.field("entityId"), id))
        .first();
      if (!already) {
        const confidence = method === "hard_key" || !target ? 1 : (e.decision.score ?? 0.8);
        await ctx.db.insert("entity_mentions", { spaceId: a.spaceId, entityId: id, chunkId: chunk._id, span: mentionSpan(chunk.text, [e.name, ...e.aliases]), confidence });
      }
    }

    let edges = 0;
    for (const ed of a.edges) {
      const sourceId = ids[ed.source];
      const targetId = ids[ed.target];
      if (!sourceId || !targetId || sourceId === targetId) continue;
      const dup = await ctx.db
        .query("edges")
        .withIndex("by_source", (q) => q.eq("sourceId", sourceId))
        .filter((q) => q.and(q.eq(q.field("targetId"), targetId), q.eq(q.field("relation"), ed.relation)))
        .first();
      if (dup) continue;
      const edgeId = await ctx.db.insert("edges", { spaceId: a.spaceId, sourceId, targetId, relation: ed.relation, evidence: ed.evidence.slice(0, 300), rule: ed.rule, version: 1 });
      await ctx.db.insert("audit_events", { spaceId: a.spaceId, actor, kind: "edge.created", payload: { edgeId, sourceId, targetId, relation: ed.relation, chunkId: chunk._id, mode: a.mode } });
      edges++;
    }

    const outcomes: Record<FactOutcome, number> = { created: 0, cited: 0, refreshed: 0, duplicate: 0, suppressed: 0 };
    for (const f of a.facts) {
      const r = await upsertFact(ctx, {
        space,
        entityId: f.entity !== undefined ? ids[f.entity] : undefined,
        category: f.category,
        text: f.text.trim(),
        confidence: Math.max(0, Math.min(1, f.confidence)),
        chunk,
        actor,
        mode: a.mode,
      });
      outcomes[r.outcome]++;
    }
    await ctx.db.patch(chunk._id, { extractedAt: now });
    const counts = { entitiesCreated: created, entitiesMatched: merged, edges, facts: outcomes };
    await ctx.db.insert("audit_events", {
      spaceId: a.spaceId,
      actor,
      kind: "brain.extracted",
      payload: { chunkId: chunk._id, sourceItemId: item._id, source: await describeSource(ctx, item), mode: a.mode, model: a.model, ...counts },
    });
    return { skipped: false as const, ...counts };
}

export const commitChunk = workerMutation({
  args: commitArgs,
  handler: async (ctx, a) => commitOne(ctx, a),
});

/** A whole pack of chunks in one transaction (batched seed_brain). Later chunks see earlier ones' entities. */
export const commitChunks = workerMutation({
  args: {
    spaceId: v.id("spaces"),
    mode: v.union(v.literal("live"), v.literal("offline")),
    model: v.string(),
    actor: v.optional(v.string()),
    chunks: v.array(v.object({ chunkId: v.id("doc_chunks"), entities: commitArgs.entities, edges: commitArgs.edges, facts: commitArgs.facts })),
  },
  handler: async (ctx, { chunks, ...shared }) => {
    // One secondary-key scan per type for the whole pack (16 MB read limit); new entities from
    // earlier chunks are still found by the indexed primary key.
    const cache: HardKeyCache = new Map();
    const out = [];
    for (const c of chunks) out.push(await commitOne(ctx, { ...shared, ...c }, cache));
    return out;
  },
});

// ---- cascade (F34/F35) ------------------------------------------------------------------------

/** Unprocessed diff_events for the space, oldest first (the cascade's resumable queue). */
export const nextDiffEvents = workerQuery({
  args: { spaceId: v.id("spaces"), limit: v.number() },
  handler: async (ctx, { spaceId, limit }) => {
    const events = await ctx.db
      .query("diff_events")
      .withIndex("by_space_processed", (q) => q.eq("spaceId", spaceId).eq("processedAt", undefined))
      .take(limit);
    return await Promise.all(
      events.map(async (e) => {
        const item = await ctx.db.get(e.sourceItemId);
        const connector = item?.connectorId ? await ctx.db.get(item.connectorId) : null;
        return { id: e._id, kind: e.kind, sourceItemId: e.sourceItemId, summary: e.summary, title: item?.title ?? "", connectorType: connector?.type ?? "manual", removed: !item || Boolean(item.removedAt) };
      }),
    );
  },
});

/**
 * After the item's current chunks are extracted: a `stale` fact whose cited passage is unchanged in
 * the new version is restored; the rest stay `stale` for review. Marks the event processed.
 * Connector items (Slack, Jira, GitHub, Notion, Drive, files) and website pages are treated alike.
 */
export const settleDiff = workerMutation({
  args: { diffEventId: v.id("diff_events"), refreshed: v.optional(v.number()) },
  handler: async (ctx, { diffEventId, refreshed }) => {
    const ev = await ctx.db.get(diffEventId);
    if (!ev) return fail(404, "Diff event not found");
    if (ev.processedAt) return { skipped: true as const, restored: 0, stillStale: 0 };
    const space = await ctx.db.get(ev.spaceId);
    const item = await ctx.db.get(ev.sourceItemId);
    if (!space) return fail(404, "Space not found");
    const source = item ? await describeSource(ctx, item) : { sourceItemId: ev.sourceItemId };
    let restored = 0;
    let stillStale = 0;
    if (item && ev.kind !== "added") {
      const current = item.removedAt
        ? []
        : await ctx.db.query("doc_chunks").withIndex("by_source_version", (q) => q.eq("sourceItemId", item._id).eq("version", item.version)).collect();
      const byKey = new Map(current.map((c) => [factKey(c.text), c]));
      const citations = await ctx.db.query("fact_citations").withIndex("by_source", (q) => q.eq("sourceItemId", item._id)).collect();
      for (const factId of new Set(citations.map((c) => c.factId))) {
        const fact = await ctx.db.get(factId);
        if (!fact || fact.status !== "stale") continue;
        let evidence: Doc<"doc_chunks"> | undefined;
        for (const c of citations.filter((x) => x.factId === factId)) {
          const old = await ctx.db.get(c.chunkId);
          if (old && old.version !== item.version) evidence ??= byKey.get(factKey(old.text));
        }
        if (evidence) {
          await addCitation(ctx, fact, evidence);
          const status = statusFor(fact.confidence, space.autoApproveThreshold);
          await ctx.db.patch(fact._id, { status, version: fact.version + 1, sourceChunkIds: [...new Set([...fact.sourceChunkIds, evidence._id])] });
          await ctx.db.insert("audit_events", {
            spaceId: ev.spaceId,
            actor: "system:cascade",
            kind: "fact.refreshed",
            payload: { factId, text: fact.text, status, chunkId: evidence._id, source, reason: "cited passage unchanged in the new version" },
          });
          restored++;
        } else {
          await ctx.db.insert("audit_events", {
            spaceId: ev.spaceId,
            actor: "system:cascade",
            kind: "fact.still_stale",
            payload: { factId, text: fact.text, source, reason: ev.kind === "removed" ? "source removed" : "not found in the new version, needs review" },
          });
          stillStale++;
        }
      }
    }
    await ctx.db.patch(ev._id, { processedAt: Date.now() });
    await ctx.db.insert("audit_events", {
      spaceId: ev.spaceId,
      actor: "system:cascade",
      kind: "cascade.event",
      payload: { diffEventId, kind: ev.kind, summary: ev.summary, source, refreshedByExtraction: refreshed ?? 0, restored, stillStale },
    });
    return { skipped: false as const, restored, stillStale };
  },
});
