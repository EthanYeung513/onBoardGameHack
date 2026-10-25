import { api } from "@convex/_generated/api";
import { Classification, classifyUserMessage, offlineClassify, passageKey, type BrainLabel } from "@/lib/brain/classify";
import { BRAIN_CLASSIFY_SYSTEM_PROMPT } from "@/lib/prompts";
import type { StageContext } from "../types";
import type { PendingChunk } from "./extract";

// Brain triage before extraction (product owner: "use mubit for classification to speed things up").
// One small Mubit call labels up to CLASSIFY_PER_CALL passages (tiny JSON out); exact duplicates
// are labelled skip without the model. Results are written by `brainWorker.labelChunks`, which
// records every skip as a `brain.skipped` audit row with its reason.

export const CLASSIFY_PER_CALL = 50;
/** The first call of a run is small so the first extraction can start sooner. */
export const FIRST_CLASSIFY_CALL = 12;

export interface Triage {
  chunk: PendingChunk;
  value: BrainLabel;
  reason: string;
}

type Ctx = Pick<StageContext, "convex" | "llm" | "space">;

/** Split for classification calls: a small first call, then CLASSIFY_PER_CALL each. */
export function classifyBatches<T>(items: T[], first = true): T[][] {
  const out: T[][] = [];
  let i = 0;
  if (first && items.length > FIRST_CLASSIFY_CALL) {
    out.push(items.slice(0, FIRST_CLASSIFY_CALL));
    i = FIRST_CLASSIFY_CALL;
  }
  for (; i < items.length; i += CLASSIFY_PER_CALL) out.push(items.slice(i, i + CLASSIFY_PER_CALL));
  return out;
}

/**
 * Label one batch: duplicates (of each other or of `seen` passages) are skipped without the model;
 * the rest go to `brain_classify` in one call. Ids the model leaves out default to high (never
 * dropped). Writes the labels, then returns them.
 */
export async function classifyBatch(ctx: Ctx, chunks: PendingChunk[], seen: Set<string>): Promise<{ triage: Triage[]; mode: "live" | "offline" }> {
  const triage: Triage[] = [];
  const ask: PendingChunk[] = [];
  for (const ch of chunks) {
    const key = passageKey(ch.text);
    if (seen.has(key)) triage.push({ chunk: ch, value: "skip", reason: "duplicate of another passage" });
    else {
      seen.add(key);
      ask.push(ch);
    }
  }
  let mode: "live" | "offline" = ctx.llm.live ? "live" : "offline";
  let model = "rules";
  if (ask.length) {
    const ids = ask.map((_, i) => `c${i + 1}`);
    const res = await ctx.llm.json({
      task: "brain_classify",
      system: BRAIN_CLASSIFY_SYSTEM_PROMPT,
      user: classifyUserMessage(ask, ctx.space.name),
      schema: Classification,
      validate: (v) => v.results.filter((r) => !ids.includes(r.id)).map((r) => `results[].id "${r.id}" is not one of the passage ids`),
      // OFFLINE STAND-IN: rule-based triage (labelled offline on the audit rows).
      offline: () => ({ results: ask.map((c, i) => ({ id: ids[i], ...offlineClassify(c) })) }),
    });
    mode = res.mode;
    model = res.model;
    const byId = new Map(res.value.results.map((r) => [r.id, r]));
    ask.forEach((ch, i) => {
      const r = byId.get(ids[i]);
      triage.push(r ? { chunk: ch, value: r.value, reason: r.reason } : { chunk: ch, value: "high", reason: "not labelled by the classifier" });
    });
  }
  await ctx.convex.mutation(api.brainWorker.labelChunks, {
    spaceId: ctx.space._id,
    mode,
    model,
    items: triage.map((t) => ({ chunkId: t.chunk.id, value: t.value, reason: t.reason })),
  });
  return { triage, mode };
}

/** "navigation or link list" ×12, … : the most common skip reasons, for the live feed. */
export function skipReasons(triage: Triage[], top = 2): string {
  const n = new Map<string, number>();
  for (const t of triage) if (t.value === "skip") n.set(t.reason || "nothing to learn", (n.get(t.reason || "nothing to learn") ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([r, k]) => `${r} ${k}`)
    .join(", ");
}
