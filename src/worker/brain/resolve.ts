import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { hardKeys, nameSimilarity, normName } from "@/lib/brain/normalize";
import { BRAIN_RESOLVE_SYSTEM_PROMPT } from "@/lib/prompts";
import { Adjudication, type ExtractedEntity } from "@/lib/brain/types";
import type { StageContext } from "../types";

// F15 entity resolution, in order: hard keys (no LLM) → embedding top-k over entities.by_embedding →
// LLM adjudication for the ambiguous band. Every decision travels with the entity to
// `brainWorker.commitChunk`, which writes it as an `entity.resolved` audit row.

/** At or above: same entity by embedding alone. */
export const EMBED_MATCH = 0.95;
/** Below: a new entity. Between the two: ask the LLM. */
export const EMBED_AMBIGUOUS = 0.8;

export interface Decision {
  method: "hard_key" | "embedding" | "llm" | "new";
  score?: number;
  reason?: string;
  candidateId?: Id<"entities">;
  mode?: "live" | "offline";
}

export interface ResolvedEntity extends ExtractedEntity {
  match?: Id<"entities">;
  decision: Decision;
  embedding?: number[];
}

export const entityEmbedText = (e: Pick<ExtractedEntity, "type" | "name" | "aliases">) => `${e.type}: ${[e.name, ...e.aliases].join(", ")}`;

/** Merge entities in one extraction that share a hard key (same type), keeping first-seen order. */
export function dedupeBatch(entities: ExtractedEntity[]): { entities: ExtractedEntity[]; indexOf: (name: string) => number | undefined } {
  const out: ExtractedEntity[] = [];
  const byKey = new Map<string, number>();
  for (const e of entities) {
    const keys = hardKeys(e).map((k) => `${e.type}|${k}`);
    const hit = keys.map((k) => byKey.get(k)).find((i) => i !== undefined);
    if (hit !== undefined) {
      const t = out[hit];
      out[hit] = { ...t, aliases: [...new Set([...t.aliases, e.name, ...e.aliases])].filter((n) => normName(n) !== normName(t.name)), keys: { ...e.keys, ...t.keys } };
      for (const k of keys) byKey.set(k, hit);
      continue;
    }
    out.push(e);
    for (const k of keys) byKey.set(k, out.length - 1);
  }
  const names = new Map<string, number>();
  out.forEach((e, i) => {
    for (const n of [e.name, ...e.aliases]) if (!names.has(normName(n))) names.set(normName(n), i);
  });
  return { entities: out, indexOf: (name) => names.get(normName(name)) };
}

type ResolveCtx = Pick<StageContext, "convex" | "llm" | "embed" | "space">;

async function adjudicate(ctx: ResolveCtx, cand: ExtractedEntity, other: { name: string; aliases: string[] }, context: string) {
  const user = JSON.stringify({ candidate: { ...cand, context: context.slice(0, 600) }, existing: { type: cand.type, ...other } });
  const r = await ctx.llm.json({
    task: "brain_resolve",
    system: BRAIN_RESOLVE_SYSTEM_PROMPT,
    user,
    schema: Adjudication,
    // OFFLINE STAND-IN: token overlap of the names (labelled offline in the audit row).
    offline: () => {
      const s = Math.max(nameSimilarity(cand.name, other.name), ...other.aliases.map((a) => nameSimilarity(cand.name, a)));
      return { same: s >= 0.6, confidence: s, reason: `offline name overlap ${s.toFixed(2)}` };
    },
  });
  return { ...r.value, mode: r.mode };
}

/** Resolution reads run this many vector searches / adjudications at once (no writes here). */
export const RESOLVE_CONCURRENCY = 8;

export async function resolveEntities(ctx: ResolveCtx, entities: ExtractedEntity[], context: string | ((i: number) => string)): Promise<ResolvedEntity[]> {
  if (!entities.length) return [];
  const ctxFor = typeof context === "string" ? () => context : context;
  // One hard-key query and one (batched) embedding call for the whole list.
  const [hard, vectors] = await Promise.all([
    ctx.convex.query(api.brainWorker.matchHardKeys, { spaceId: ctx.space._id, items: entities }),
    ctx.embed.embed(entities.map(entityEmbedText)),
  ]);
  const out: ResolvedEntity[] = new Array(entities.length);
  let next = 0;
  const lane = async () => {
    while (next < entities.length) {
      const i = next++;
      out[i] = await resolveOne(ctx, entities[i], hard[i], vectors[i], ctxFor(i));
    }
  };
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, entities.length) }, lane));
  return out;
}

async function resolveOne(
  ctx: ResolveCtx,
  e: ExtractedEntity,
  h: { id: Id<"entities">; key: string } | null,
  vector: number[],
  context: string,
): Promise<ResolvedEntity> {
  if (h) return { ...e, match: h.id, decision: { method: "hard_key", score: 1, reason: `shares ${h.key}` }, embedding: vector };
  if (!ctx.convex.action) throw new Error("Entity resolution needs worker actions (vector search)");
  const similar = await ctx.convex.action(api.brainWorker.similarEntities, { spaceId: ctx.space._id, type: e.type, vector, k: 3 });
  const top = similar[0];
  if (top && top.score >= EMBED_MATCH) {
    return { ...e, match: top.id, decision: { method: "embedding", score: top.score, candidateId: top.id, reason: `nearest "${top.name}"` }, embedding: vector };
  }
  if (top && top.score >= EMBED_AMBIGUOUS) {
    const verdict = await adjudicate(ctx, e, top, context);
    return {
      ...e,
      match: verdict.same ? top.id : undefined,
      decision: { method: "llm", score: top.score, candidateId: top.id, reason: verdict.reason || (verdict.same ? "same" : "different"), mode: verdict.mode },
      embedding: vector,
    };
  }
  return { ...e, decision: { method: "new", score: top?.score, candidateId: top?.id }, embedding: vector };
}
