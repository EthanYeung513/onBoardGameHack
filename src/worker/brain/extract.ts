import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { offlineExtract } from "@/lib/brain/offline";
import { ExtractionBatch } from "@/lib/brain/types";
import { BRAIN_EXTRACT_SYSTEM_PROMPT } from "@/lib/prompts";
import type { StageContext } from "../types";
import { dedupeBatch, resolveEntities } from "./resolve";

// One chunk → validated extraction (fixed system prompt, Zod, labelled offline stand-in) → F15
// resolution → `brainWorker.commitChunk`. Shared by the `seed_brain` and `cascade` stages.

export type PendingChunk = FunctionReturnType<typeof api.brainWorker.pendingChunks>[number];
type ExtractCtx = Pick<StageContext, "convex" | "llm" | "embed" | "space">;

/** Everything that varies goes in the user message (AGENTS.md "Model boundaries"). */
export function extractionUserMessage(chunk: Pick<PendingChunk, "text" | "title" | "kind" | "connectorType">, rejected: string[], company: string) {
  return [
    `Company: ${company}`,
    `Source: ${chunk.connectorType} ${chunk.kind} — ${chunk.title}`,
    rejected.length ? `Rejected facts (never re-propose these or paraphrases):\n${rejected.map((r) => `- ${r}`).join("\n")}` : "Rejected facts: none",
    `Chunk (character offsets start at 0):\n<<<\n${chunk.text}\n>>>`,
  ].join("\n\n");
}

/** The model call alone — safe to run for several chunks in parallel (no writes). */
export function llmExtract(ctx: Pick<ExtractCtx, "llm" | "space">, chunk: PendingChunk, rejected: string[]) {
  return ctx.llm.json({
    task: "brain_extract",
    system: BRAIN_EXTRACT_SYSTEM_PROMPT,
    user: extractionUserMessage(chunk, rejected, ctx.space.name),
    schema: ExtractionBatch,
    offline: () => offlineExtract(chunk.text),
  });
}

export type Extraction = Awaited<ReturnType<typeof llmExtract>>;

export async function extractChunk(ctx: ExtractCtx, chunk: PendingChunk, rejected: string[], actor = "agent:seed_brain") {
  return resolveAndCommit(ctx, chunk, await llmExtract(ctx, chunk, rejected), actor);
}

/** F15 resolution + commit. Run sequentially: resolution reads entities the previous commit wrote. */
export async function resolveAndCommit(ctx: ExtractCtx, chunk: PendingChunk, res: Extraction, actor = "agent:seed_brain") {
  const batch = res.value;
  const { entities, indexOf } = dedupeBatch(batch.entities);
  const resolved = await resolveEntities(ctx, entities, chunk.text);
  const len = chunk.text.length;
  const facts = batch.facts.map((f) => {
    const entity = f.entity_names.map(indexOf).find((i) => i !== undefined);
    const start = Math.min(f.span.start, len);
    return { category: f.category, text: f.text, entity, confidence: f.confidence, span: { start, end: Math.max(start, Math.min(f.span.end, len)) } };
  });
  const edges = batch.edges.flatMap((e) => {
    const source = indexOf(e.source);
    const target = indexOf(e.target);
    if (source === undefined || target === undefined) return [];
    return [{ source, target, relation: e.relation, evidence: e.evidence, ...(res.mode === "offline" ? { rule: "offline-rules:v1" } : {}) }];
  });
  // JSON round-trip drops `undefined` fields (optional keys, unmatched entities) before the wire.
  const args = JSON.parse(JSON.stringify({
    spaceId: ctx.space._id,
    chunkId: chunk.id,
    mode: res.mode,
    model: res.model,
    actor,
    entities: resolved.map((e) => ({ type: e.type, name: e.name, aliases: e.aliases, keys: e.keys, match: e.match, decision: e.decision, embedding: e.embedding })),
    edges,
    facts,
  }));
  const result = await ctx.convex.mutation(api.brainWorker.commitChunk, args);
  return { ...result, mode: res.mode };
}
