import { offlineExtract } from "@/lib/brain/offline";
import { MultiExtraction, type ExtractionBatch } from "@/lib/brain/types";
import { BRAIN_EXTRACT_BATCH_SYSTEM_PROMPT } from "@/lib/prompts";
import type { StageContext } from "../types";
import type { PendingChunk } from "./extract";
import { dedupeBatch, resolveEntities } from "./resolve";

// Batched brain extraction (perf target: facts in the brain within seconds of a scan).
//   1. the stage's PackPool packs passages: <= PASSAGES_PER_CALL per Mubit call (and a character
//      budget); output tokens dominate a call's latency, so packs stay small and run in parallel;
//   2. per pack: entities deduped across all its passages and resolved once (one hard-key query,
//      one embedding call, parallel vector searches), then the pack commits in ONE mutation.

export const PASSAGES_PER_CALL = 6;
export const CHARS_PER_CALL = 36_000;

type Ctx = Pick<StageContext, "convex" | "llm" | "embed" | "space">;

/** Everything that varies goes in the user message (AGENTS.md "Model boundaries"). */
export function batchUserMessage(chunks: Pick<PendingChunk, "text" | "title" | "kind" | "connectorType">[], rejected: string[], company: string) {
  return [
    `Company: ${company}`,
    rejected.length ? `Rejected facts (never re-propose these or paraphrases):\n${rejected.map((r) => `- ${r}`).join("\n")}` : "Rejected facts: none",
    ...chunks.map((c, i) => `### Passage id: p${i + 1}\nSource: ${c.connectorType} ${c.kind} — ${c.title}\nText (character offsets start at 0):\n<<<\n${c.text}\n>>>`),
  ].join("\n\n");
}

export interface PackExtraction {
  byChunk: Map<string, ExtractionBatch>;
  mode: "live" | "offline";
  model: string;
}

/** One Mubit call for a pack of passages. Missing ids come back as empty extractions. */
export async function extractPack(ctx: Pick<Ctx, "llm" | "space">, chunks: PendingChunk[], rejected: string[]): Promise<PackExtraction> {
  const ids = chunks.map((_, i) => `p${i + 1}`);
  const res = await ctx.llm.json({
    task: "brain_extract_batch",
    system: BRAIN_EXTRACT_BATCH_SYSTEM_PROMPT,
    user: batchUserMessage(chunks, rejected, ctx.space.name),
    schema: MultiExtraction,
    validate: (v) => v.results.filter((r) => !ids.includes(r.id)).map((r) => `results[].id "${r.id}" is not one of the passage ids (${ids.join(", ")})`),
    // OFFLINE STAND-IN: the rule-based extractor per passage (labelled offline in the audit rows).
    offline: () => ({ results: chunks.map((c, i) => ({ id: ids[i], ...offlineExtract(c.text) })) }),
  });
  const byChunk = new Map<string, ExtractionBatch>();
  for (const r of res.value.results) {
    const i = ids.indexOf(r.id);
    if (i >= 0 && !byChunk.has(chunks[i].id)) byChunk.set(chunks[i].id, { facts: r.facts, entities: r.entities, edges: r.edges });
  }
  for (const c of chunks) if (!byChunk.has(c.id)) byChunk.set(c.id, { facts: [], entities: [], edges: [] });
  return { byChunk, mode: res.mode, model: res.model };
}

/** Resolve a pack's entities once (deduped across passages) and build each chunk's commit payload. */
export async function buildPackCommit(ctx: Ctx, chunks: PendingChunk[], pack: PackExtraction) {
  const perChunk = chunks.map((c) => ({ chunk: c, local: dedupeBatch(pack.byChunk.get(c.id)!.entities) }));
  const all = dedupeBatch(perChunk.flatMap((p) => p.local.entities));
  const firstChunkOf = all.entities.map((e) => perChunk.find((p) => p.local.indexOf(e.name) !== undefined)?.chunk.text ?? "");
  const resolved = await resolveEntities(ctx, all.entities, (i) => firstChunkOf[i]);
  return perChunk.map(({ chunk, local }) => {
    const batch = pack.byChunk.get(chunk.id)!;
    const len = chunk.text.length;
    const entities = local.entities.map((e) => {
      const g = resolved[all.indexOf(e.name)!];
      return { type: e.type, name: e.name, aliases: e.aliases, keys: e.keys, match: g.match, decision: g.decision, embedding: g.embedding };
    });
    const facts = batch.facts.map((f) => {
      const entity = f.entity_names.map(local.indexOf).find((i) => i !== undefined);
      const start = Math.min(f.span.start, len);
      return { category: f.category, text: f.text, entity, confidence: f.confidence, span: { start, end: Math.max(start, Math.min(f.span.end, len)) } };
    });
    const edges = batch.edges.flatMap((e) => {
      const source = local.indexOf(e.source);
      const target = local.indexOf(e.target);
      if (source === undefined || target === undefined) return [];
      return [{ source, target, relation: e.relation, evidence: e.evidence, ...(pack.mode === "offline" ? { rule: "offline-rules:v1" } : {}) }];
    });
    // JSON round-trip drops `undefined` fields before the wire (as in extract.ts).
    return JSON.parse(JSON.stringify({ chunkId: chunk.id, entities, edges, facts }));
  });
}
