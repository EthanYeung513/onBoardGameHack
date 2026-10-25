import { api } from "@convex/_generated/api";
import { extractChunk } from "../brain/extract";
import type { StageDefinition } from "../types";

// F14/F15: builds the company brain from every `doc_chunks` row without `extractedAt` (website
// pages and connector items alike), a chunk at a time so a resumed slice repeats nothing. Ends by
// queueing `cascade` so diff_events from the same ingest settle (stale facts restored or flagged).

/** Leave this much of the slice for the last commit + reporting. */
const RESERVE_MS = 12_000;

interface Cursor {
  chunks?: number;
  created?: number;
  approved?: number;
  mode?: "live" | "offline";
}

export const seedBrainStage: StageDefinition = {
  name: "seed_brain",
  async run(ctx) {
    const c: Required<Cursor> = { chunks: 0, created: 0, approved: 0, mode: "live", ...(ctx.job.cursor as Cursor) };
    const spaceId = ctx.space._id;
    const rejected = await ctx.convex.query(api.brainWorker.rejectedExamples, { spaceId });
    if (!ctx.llm.live && c.chunks === 0) {
      await ctx.event("warn", "Offline stand-in: rule-based extraction (no MUBIT_API_KEY) — every fact lands as a draft for review");
    }
    for (;;) {
      const batch = await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, limit: 8 });
      if (!batch.length) break;
      for (const chunk of batch) {
        if (ctx.remainingMs() < RESERVE_MS || ctx.lost()) {
          const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
          return { done: false, cursor: { ...c }, progress: c.chunks / (c.chunks + left || 1) };
        }
        if (chunk.obsolete) {
          await ctx.convex.mutation(api.brainWorker.commitChunk, { spaceId, chunkId: chunk.id, mode: ctx.llm.live ? "live" : "offline", model: "-", entities: [], edges: [], facts: [] });
          continue;
        }
        const r = await extractChunk(ctx, chunk, rejected);
        c.mode = r.mode;
        if (r.skipped) continue;
        c.chunks++;
        c.created += r.facts.created;
        await ctx.progress(0.5, { ...c });
        await ctx.event("info", `Read “${chunk.title}” (${chunk.connectorType}): ${r.facts.created} new facts, ${r.entitiesCreated} new entities`, {
          chunkId: chunk.id,
          mode: r.mode,
          ...r.facts,
        });
      }
    }
    const summary = `${c.chunks} chunks read, ${c.created} facts extracted${c.mode === "offline" ? " (offline stand-in)" : ""}`;
    return { done: true, summary, next: [{ stage: "cascade" }] };
  },
};
