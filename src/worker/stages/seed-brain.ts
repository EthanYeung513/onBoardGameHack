import { api } from "@convex/_generated/api";
import { buildPackCommit, extractPack, packBatches, PASSAGES_PER_CALL, type PackExtraction } from "../brain/batch";
import type { PendingChunk } from "../brain/extract";
import type { StageDefinition } from "../types";

// F14/F15: builds the company brain from every `doc_chunks` row without `extractedAt` (website
// pages and connector items alike; only new/changed content lacks it, so re-scans re-learn just
// what changed). Batched for speed (product owner: "seconds, not minutes"):
//   • ≤ PASSAGES_PER_CALL passages per Mubit call, PACKS_IN_FLIGHT calls in parallel (no writes);
//   • per pack, in order: entities resolved once (deduped, one embedding call, parallel vector
//     searches) → one `commitChunks` mutation — so entities never duplicate and resumes repeat nothing;
//   • a scan's first pass stops at FIRST_PASS_PASSAGES; the rest continues as a detached
//     background seed_brain job so the scan (and course drafting) never waits on long tails.
// Ends by queueing `cascade` so diff_events from the same ingest settle.

/** Parallel Mubit extraction calls (each carries up to PASSAGES_PER_CALL passages). */
export const PACKS_IN_FLIGHT = 10;
/** Passages a scan learns from before the scan moves on; the rest continue in the background. */
export const FIRST_PASS_PASSAGES = 96;
/** A round (≤ PACKS_IN_FLIGHT parallel calls) needs this much slice left to start; once started,
 * every finished call is committed — paid-for extractions are never thrown away. */
const ROUND_MIN_MS = 90_000;

interface Cursor {
  chunks?: number;
  created?: number;
  entities?: number;
  total?: number;
  mode?: "live" | "offline";
}

export const seedBrainStage: StageDefinition = {
  name: "seed_brain",
  // Batched calls carry many passages each; a long slice (heartbeats keep it alive) lets a whole
  // round of parallel calls land and commit.
  budgetMs: 180_000,
  async run(ctx) {
    const c: Required<Cursor> = { chunks: 0, created: 0, entities: 0, total: 0, mode: "live", ...(ctx.job.cursor as Cursor) };
    const spaceId = ctx.space._id;
    const firstPass = Boolean(ctx.job.scanId);
    const rejected = await ctx.convex.query(api.brainWorker.rejectedExamples, { spaceId });
    if (!ctx.llm.live && c.chunks === 0) {
      await ctx.event("warn", "Offline stand-in: rule-based extraction (no MUBIT_API_KEY) — every fact lands as a draft for review");
    }
    if (!c.total) {
      const pending = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
      c.total = c.chunks + (firstPass ? Math.min(pending, FIRST_PASS_PASSAGES) : pending);
      const more = firstPass && pending > FIRST_PASS_PASSAGES ? ` (the first ${FIRST_PASS_PASSAGES} now, the rest in the background)` : "";
      await ctx.event("info", `${pending}${pending >= 300 ? "+" : ""} new or changed passages to learn from${more}`, { step: "brain", total: c.total, pending });
    }
    const pause = async () => {
      const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
      return { done: false as const, cursor: { ...c }, progress: c.chunks / (c.chunks + left || 1) };
    };

    for (;;) {
      if (firstPass && c.chunks >= FIRST_PASS_PASSAGES) {
        const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
        if (left > 0) {
          await ctx.event("info", `First pass done — ${left}${left >= 300 ? "+" : ""} more passages keep enriching the brain in the background`);
          return { done: true, summary: summary(c), next: [{ stage: "seed_brain", detached: true }, { stage: "cascade" }] };
        }
        break;
      }
      if (ctx.remainingMs() < ROUND_MIN_MS || ctx.lost()) return pause();
      const room = firstPass ? FIRST_PASS_PASSAGES - c.chunks : Infinity;
      const limit = Math.min(PACKS_IN_FLIGHT * PASSAGES_PER_CALL, room);
      const round = await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, limit });
      if (!round.length) break;

      const obsolete = round.filter((ch) => ch.obsolete);
      if (obsolete.length) {
        await ctx.convex.mutation(api.brainWorker.commitChunks, {
          spaceId,
          mode: ctx.llm.live ? "live" : "offline",
          model: "-",
          chunks: obsolete.map((ch) => ({ chunkId: ch.id, entities: [], edges: [], facts: [] })),
        });
      }
      const packs = packBatches(round.filter((ch) => !ch.obsolete));
      // All packs' model calls start at once (bounded) …
      const calls = startBounded(packs, PACKS_IN_FLIGHT, (pack) => extractPack(ctx, pack, rejected));
      // If we pause early, calls still in flight must not become unhandled rejections.
      for (const call of calls) call.catch(() => undefined);
      // … and each pack resolves + commits in order as soon as its call returns.
      for (let i = 0; i < packs.length; i++) {
        const extraction = await calls[i]; // a failed call throws → the pipeline retries; committed packs are kept
        if (ctx.lost()) return pause();
        await commitPack(ctx, packs[i], extraction, c);
      }
    }
    return { done: true, summary: summary(c), next: [{ stage: "cascade" }] };
  },
};

function summary(c: Required<Cursor>) {
  return `${c.chunks} passages read, ${c.created} facts extracted${c.mode === "offline" ? " (offline stand-in)" : ""}`;
}

/** Start every task with at most `limit` running; returns one promise per item, in order. */
function startBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R>[] {
  let running = 0;
  const queue: (() => void)[] = [];
  return items.map(
    (item) =>
      new Promise<R>((resolve, reject) => {
        const run = () => {
          running++;
          fn(item)
            .then(resolve, reject)
            .finally(() => {
              running--;
              queue.shift()?.();
            });
        };
        if (running < limit) run();
        else queue.push(run);
      }),
  );
}

async function commitPack(ctx: Parameters<StageDefinition["run"]>[0], pack: PendingChunk[], extraction: PackExtraction, c: Required<Cursor>) {
  const payload = await buildPackCommit(ctx, pack, extraction);
  const results = await ctx.convex.mutation(api.brainWorker.commitChunks, {
    spaceId: ctx.space._id,
    mode: extraction.mode,
    model: extraction.model,
    chunks: payload,
  });
  c.mode = extraction.mode;
  let facts = 0;
  let entities = 0;
  let read = 0;
  for (const r of results) {
    if (r.skipped) continue;
    read++;
    facts += r.facts.created;
    entities += r.entitiesCreated;
  }
  c.chunks += read;
  c.created += facts;
  c.entities += entities;
  await ctx.progress(Math.min(0.99, c.chunks / Math.max(1, c.total)), { ...c });
  const titles = [...new Set(pack.map((p) => p.title).filter(Boolean))];
  await ctx.event(
    "info",
    `Read ${read} passages (${titles.slice(0, 2).join(", ")}${titles.length > 2 ? ` +${titles.length - 2} more` : ""}): ${facts} new facts, ${entities} new entities · ${c.chunks}/${Math.max(c.total, c.chunks)} passages · ${c.entities} entities so far`,
    { mode: extraction.mode, progress: { chunks: c.chunks, total: c.total, entities: c.entities, facts: c.created } },
  );
}
