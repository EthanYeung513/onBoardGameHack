import { api } from "@convex/_generated/api";
import { llmExtract, resolveAndCommit, type Extraction } from "../brain/extract";
import type { StageDefinition } from "../types";

// F14/F15: builds the company brain from every `doc_chunks` row without `extractedAt` (website
// pages and connector items alike). Per batch the Mubit extraction calls run in parallel
// (EXTRACT_CONCURRENCY, no writes); resolution + commit then run one chunk at a time, in order,
// so entities never duplicate and a resumed slice repeats nothing. Only new/changed content has
// no `extractedAt`, so a re-scan re-learns just what changed. Ends by queueing `cascade`.

/** Leave this much of the slice for the last commit + reporting. */
const RESERVE_MS = 12_000;
/** Parallel extraction calls per batch (model calls only; commits stay sequential). */
export const EXTRACT_CONCURRENCY = 6;
/** A batch of parallel calls needs at least this much slice left to start. */
const BATCH_MIN_MS = 25_000;

interface Cursor {
  chunks?: number;
  created?: number;
  approved?: number;
  entities?: number;
  total?: number;
  mode?: "live" | "offline";
}

async function inPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

export const seedBrainStage: StageDefinition = {
  name: "seed_brain",
  async run(ctx) {
    const c: Required<Cursor> = { chunks: 0, created: 0, approved: 0, entities: 0, total: 0, mode: "live", ...(ctx.job.cursor as Cursor) };
    const spaceId = ctx.space._id;
    const rejected = await ctx.convex.query(api.brainWorker.rejectedExamples, { spaceId });
    if (!ctx.llm.live && c.chunks === 0) {
      await ctx.event("warn", "Offline stand-in: rule-based extraction (no MUBIT_API_KEY) — every fact lands as a draft for review");
    }
    if (!c.total) {
      const pending = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
      c.total = c.chunks + pending;
      await ctx.event("info", `${pending}${pending >= 300 ? "+" : ""} new or changed passages to learn from`, { step: "brain", total: c.total });
    }
    const pause = async () => {
      const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
      return { done: false as const, cursor: { ...c }, progress: c.chunks / (c.chunks + left || 1) };
    };
    for (;;) {
      if (ctx.remainingMs() < BATCH_MIN_MS || ctx.lost()) return pause();
      const batch = await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, limit: 8 });
      if (!batch.length) break;
      const live = batch.filter((ch) => !ch.obsolete);
      // Parallel model calls (no writes) …
      const results = await inPool(live, EXTRACT_CONCURRENCY, (ch) => llmExtract(ctx, ch, rejected));
      const byId = new Map(live.map((ch, i) => [ch.id, results[i]]));
      // … then resolve + commit in order, one chunk at a time.
      for (const chunk of batch) {
        if (ctx.lost() || ctx.remainingMs() < RESERVE_MS) return pause();
        if (chunk.obsolete) {
          await ctx.convex.mutation(api.brainWorker.commitChunk, { spaceId, chunkId: chunk.id, mode: ctx.llm.live ? "live" : "offline", model: "-", entities: [], edges: [], facts: [] });
          continue;
        }
        const settled = byId.get(chunk.id)!;
        if (settled.status === "rejected") throw settled.reason; // retried by the pipeline; committed chunks are kept
        const r = await resolveAndCommit(ctx, chunk, settled.value as Extraction);
        c.mode = r.mode;
        if (r.skipped) continue;
        c.chunks++;
        c.created += r.facts.created;
        c.entities += r.entitiesCreated;
        await ctx.progress(Math.min(0.99, c.chunks / Math.max(1, c.total)), { ...c });
        await ctx.event("info", `Read “${chunk.title}” (${chunk.connectorType}): ${r.facts.created} new facts, ${r.entitiesCreated} new entities · ${c.chunks}/${Math.max(c.total, c.chunks)} passages · ${c.entities} entities so far`, {
          chunkId: chunk.id,
          mode: r.mode,
          progress: { chunks: c.chunks, total: c.total, entities: c.entities, facts: c.created },
          ...r.facts,
        });
      }
    }
    const summary = `${c.chunks} chunks read, ${c.created} facts extracted${c.mode === "offline" ? " (offline stand-in)" : ""}`;
    return { done: true, summary, next: [{ stage: "cascade" }] };
  },
};
