import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { factKey, hardKeys, type KeyedEntity } from "../../src/lib/brain/normalize";

// Brain writes shared by extraction (convex/brainWorker.ts) and manager review (convex/facts.ts).
// Invariants (BUILD-CONTRACT "Brain contract"): every fact cites ≥1 chunk (a `fact_citations` row
// per chunk), facts dedupe on (entity, normalised text), rejected facts never resurface, and every
// write emits an `audit_events` row.

export type FactOutcome = "created" | "cited" | "refreshed" | "duplicate" | "suppressed";

/** Initial status for an agent fact: approved at/above the space's threshold, otherwise draft. */
export const statusFor = (confidence: number, threshold: number): "approved" | "draft" => (confidence >= threshold ? "approved" : "draft");

export async function addCitation(ctx: MutationCtx, fact: Doc<"facts">, chunk: Doc<"doc_chunks">) {
  const existing = await ctx.db.query("fact_citations").withIndex("by_fact", (q) => q.eq("factId", fact._id)).collect();
  if (existing.some((c) => c.chunkId === chunk._id)) return false;
  await ctx.db.insert("fact_citations", { spaceId: fact.spaceId, factId: fact._id, chunkId: chunk._id, sourceItemId: chunk.sourceItemId });
  return true;
}

/** Facts in the space with this dedupe key (any status, any entity). */
export async function factsByKey(ctx: MutationCtx, spaceId: Id<"spaces">, key: string) {
  return await ctx.db
    .query("facts")
    .withIndex("by_space_dedupe", (q) => q.eq("spaceId", spaceId).eq("dedupeKey", key))
    .take(50);
}

export async function upsertFact(
  ctx: MutationCtx,
  a: {
    space: Doc<"spaces">;
    entityId?: Id<"entities">;
    category: Doc<"facts">["category"];
    text: string;
    confidence: number;
    chunk: Doc<"doc_chunks">;
    actor: string;
    mode: "live" | "offline";
  },
): Promise<{ outcome: FactOutcome; factId?: Id<"facts"> }> {
  const key = factKey(a.text);
  const same = await factsByKey(ctx, a.space._id, key);
  const rejected = same.find((f) => f.status === "rejected");
  if (rejected) {
    await ctx.db.insert("audit_events", {
      spaceId: a.space._id,
      actor: a.actor,
      kind: "fact.suppressed",
      payload: { factId: rejected._id, text: a.text, chunkId: a.chunk._id, reason: "matches a rejected fact", mode: a.mode },
    });
    return { outcome: "suppressed", factId: rejected._id };
  }
  const existing = same.find((f) => f.entityId === a.entityId);
  if (existing) {
    const cited = await addCitation(ctx, existing, a.chunk);
    const sourceChunkIds = cited ? [...existing.sourceChunkIds, a.chunk._id] : existing.sourceChunkIds;
    if (existing.status === "stale") {
      const confidence = Math.max(existing.confidence, a.confidence);
      const status = statusFor(confidence, a.space.autoApproveThreshold);
      await ctx.db.patch(existing._id, { status, confidence, sourceChunkIds, version: existing.version + 1 });
      await ctx.db.insert("audit_events", {
        spaceId: a.space._id,
        actor: a.actor,
        kind: "fact.refreshed",
        payload: { factId: existing._id, text: existing.text, status, chunkId: a.chunk._id, sourceItemId: a.chunk.sourceItemId, reason: "re-extracted from the new version", mode: a.mode },
      });
      return { outcome: "refreshed", factId: existing._id };
    }
    if (!cited) return { outcome: "duplicate", factId: existing._id };
    await ctx.db.patch(existing._id, { sourceChunkIds });
    await ctx.db.insert("audit_events", {
      spaceId: a.space._id,
      actor: a.actor,
      kind: "fact.cited",
      payload: { factId: existing._id, chunkId: a.chunk._id, sourceItemId: a.chunk.sourceItemId, mode: a.mode },
    });
    return { outcome: "cited", factId: existing._id };
  }
  const status = statusFor(a.confidence, a.space.autoApproveThreshold);
  const factId = await ctx.db.insert("facts", {
    spaceId: a.space._id,
    entityId: a.entityId,
    category: a.category,
    text: a.text,
    confidence: a.confidence,
    sourceChunkIds: [a.chunk._id],
    status,
    createdBy: "agent",
    version: 1,
    dedupeKey: key,
  });
  await ctx.db.insert("fact_citations", { spaceId: a.space._id, factId, chunkId: a.chunk._id, sourceItemId: a.chunk.sourceItemId });
  await ctx.db.insert("audit_events", {
    spaceId: a.space._id,
    actor: a.actor,
    kind: "fact.created",
    payload: { factId, text: a.text, category: a.category, confidence: a.confidence, status, chunkId: a.chunk._id, sourceItemId: a.chunk.sourceItemId, mode: a.mode },
  });
  return { outcome: "created", factId };
}

/** Follow `mergedInto` to the canonical entity. */
export async function canonical(ctx: MutationCtx, id: Id<"entities">) {
  let e = await ctx.db.get(id);
  for (let hops = 0; e?.mergedInto && hops < 5; hops++) e = await ctx.db.get(e.mergedInto);
  return e;
}

export function entityKeys(e: Doc<"entities">): string[] {
  const stored = (e.fields as { keys?: string[] } | undefined)?.keys ?? [];
  return [...new Set([e.key, ...stored, ...hardKeys({ name: e.name, aliases: e.aliases })])];
}

/** Hard-key resolution (F15 step 1): the same-type entity sharing any hard key with the candidate. */
export async function findByHardKeys(ctx: QueryCtx | MutationCtx, spaceId: Id<"spaces">, type: Doc<"entities">["type"], cand: KeyedEntity) {
  const keys = hardKeys(cand);
  if (!keys.length) return null;
  // Fast path: the strongest stored key is indexed.
  for (const k of keys) {
    const hit = await ctx.db
      .query("entities")
      .withIndex("by_space_key", (q) => q.eq("spaceId", spaceId).eq("type", type).eq("key", k))
      .first();
    if (hit && !hit.mergedInto) return { entity: hit, key: k };
  }
  // Secondary keys (aliases, extra emails/logins) live in `fields.keys`: scan this type in the space.
  const wanted = new Set(keys);
  for await (const e of ctx.db.query("entities").withIndex("by_space_key", (q) => q.eq("spaceId", spaceId).eq("type", type))) {
    if (e.mergedInto) continue;
    const k = entityKeys(e).find((x) => wanted.has(x));
    if (k) return { entity: e, key: k };
  }
  return null;
}
