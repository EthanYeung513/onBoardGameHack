import { api } from "@convex/_generated/api";
import { buildPackCommit, extractPack, CHARS_PER_CALL, PASSAGES_PER_CALL, type PackExtraction } from "../brain/batch";
import { classifyBatch, classifyBatches, skipReasons } from "../brain/classify";
import type { PendingChunk } from "../brain/extract";
import { PackPool } from "../brain/pool";
import { profiled } from "../brain/profile";
import type { StageDefinition } from "../types";

// F14/F15: builds the company brain from every `doc_chunks` row without `extractedAt` (website
// pages and connector items alike; only new/changed content lacks it, so re-scans re-learn just
// what changed). Fast by design (product owner: facts flow into the brain within seconds):
//   1. triage: one cheap `brain_classify` call labels up to 50 passages (high / low / skip);
//      skip is recorded (audit row with the reason) and never extracted;
//   2. high passages stream into a PackPool as soon as their triage call returns: the first
//      pack is small so the first facts land in seconds, then PASSAGES_PER_CALL per call,
//      PACKS_IN_FLIGHT calls at once, each committed (one `commitChunks`) the moment it finishes;
//   3. low passages follow every high one; on a scan's first pass they (and anything past
//      FIRST_PASS_PASSAGES) continue as a detached background seed_brain job.
// Ends by queueing `cascade` so diff_events from the same ingest settle.

/** Parallel Mubit extraction calls. */
export const PACKS_IN_FLIGHT = 10;
/** Passages in the first extraction call of a run: small, so the first facts commit fast. */
export const FIRST_PACK = 3;
/** High passages a scan learns from before the scan moves on; the rest continue in the background. */
export const FIRST_PASS_PASSAGES = 96;
/** Unclassified passages read per round (one small call per 50). */
const TRIAGE_ROUND = 150;
/** A new extraction call needs this much slice left; calls already running always commit. */
const CALL_MIN_MS = 60_000;

interface Cursor {
  chunks?: number;
  created?: number;
  entities?: number;
  total?: number;
  classified?: number;
  skipped?: number;
  high?: number;
  low?: number;
  mode?: "live" | "offline";
}

type Ctx = Parameters<StageDefinition["run"]>[0];

export const seedBrainStage: StageDefinition = {
  name: "seed_brain",
  // A long slice (heartbeats keep it alive) lets a whole round of parallel calls land and commit.
  budgetMs: 180_000,
  async run(stageCtx) {
    const ctx = profiled(stageCtx, "seed_brain");
    const c: Required<Cursor> = { chunks: 0, created: 0, entities: 0, total: 0, classified: 0, skipped: 0, high: 0, low: 0, mode: "live", ...(ctx.job.cursor as Cursor) };
    const spaceId = ctx.space._id;
    const firstPass = Boolean(ctx.job.scanId ?? ctx.job.sourceScanId);
    const rejected = await ctx.convex.query(api.brainWorker.rejectedExamples, { spaceId });
    if (!ctx.llm.live && c.chunks === 0) {
      await ctx.event("warn", "Offline stand-in: rule-based triage and extraction (no MUBIT_API_KEY). Every fact lands as a draft for review");
    }
    if (!c.total) {
      const pending = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId });
      c.total = c.chunks + c.skipped + pending;
      await ctx.event("info", `${pending}${pending >= 300 ? "+" : ""} new or changed passages to triage and learn from`, { step: "brain", total: c.total, pending });
    }
    const seen = new Set<string>();
    const room = () => (firstPass ? FIRST_PASS_PASSAGES - c.chunks : Infinity);

    for (;;) {
      if (ctx.lost() || ctx.remainingMs() < CALL_MIN_MS) return pause(ctx, c);
      if (room() <= 0) return handOff(ctx, c);
      const pool = new PackPool({
        inFlight: PACKS_IN_FLIGHT,
        firstPack: c.chunks === 0 ? FIRST_PACK : PASSAGES_PER_CALL,
        packSize: PASSAGES_PER_CALL,
        maxChars: CHARS_PER_CALL,
        canLaunch: () => !ctx.lost() && ctx.remainingMs() >= CALL_MIN_MS,
        extract: (pack) => extractPack(ctx, pack, rejected),
        commit: (pack, extraction) => commitPack(ctx, pack, extraction, c),
      });
      let budget = room();
      const feed = (chunks: PendingChunk[]) => {
        const take = chunks.slice(0, Math.max(0, budget));
        budget -= take.length;
        if (take.length) pool.add(take);
      };

      // Already-labelled high passages first (from an earlier slice), then triage new ones.
      const high = await live(ctx, await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, label: "high", limit: Math.min(budget, PACKS_IN_FLIGHT * PASSAGES_PER_CALL) }));
      feed(high);
      const fresh = budget > 0 ? await live(ctx, await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, label: "none", limit: TRIAGE_ROUND })) : [];
      const lows: PendingChunk[] = [];
      const triaged = classifyBatches(fresh, c.classified === 0).map(async (batch) => {
        const { triage } = await classifyBatch(ctx, batch, seen);
        const n = { high: 0, low: 0, skip: 0 };
        for (const t of triage) n[t.value]++;
        c.classified += triage.length;
        c.skipped += n.skip;
        c.high += n.high;
        c.low += n.low;
        feed(triage.filter((t) => t.value === "high").map((t) => t.chunk));
        lows.push(...triage.filter((t) => t.value === "low").map((t) => t.chunk));
        const why = skipReasons(triage);
        await ctx.event(
          "info",
          `Triaged ${triage.length} passages: ${n.high} to learn now, ${n.low} later, ${n.skip} skipped${why ? ` (${why})` : ""}`,
          { step: "brain", triage: n, progress: progressData(c) },
        );
      });
      // A failed triage call still lets every started extraction finish and commit first.
      const triageDone = await Promise.allSettled(triaged);
      if (!firstPass) {
        // Low passages after every high one; earlier slices' lows when nothing new arrived.
        const older = !fresh.length && !high.length ? await live(ctx, await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, label: "low", limit: PACKS_IN_FLIGHT * PASSAGES_PER_CALL })) : [];
        feed([...lows, ...older]);
      }
      const started = c.chunks;
      await pool.drain();
      const failed = triageDone.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
      if (pool.stopped) return pause(ctx, c);
      if (!fresh.length && !high.length && c.chunks === started) break; // nothing left this pass can learn
    }
    return finish(ctx, c, firstPass);
  },
};

/** Obsolete chunks (removed or superseded source versions) are marked done without the model. */
async function live(ctx: Ctx, chunks: PendingChunk[]) {
  const obsolete = chunks.filter((ch) => ch.obsolete);
  if (obsolete.length) {
    await ctx.convex.mutation(api.brainWorker.commitChunks, {
      spaceId: ctx.space._id,
      mode: ctx.llm.live ? "live" : "offline",
      model: "-",
      chunks: obsolete.map((ch) => ({ chunkId: ch.id, entities: [], edges: [], facts: [] })),
    });
  }
  return chunks.filter((ch) => !ch.obsolete);
}

async function pause(ctx: Ctx, c: Required<Cursor>) {
  const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId: ctx.space._id });
  return { done: false as const, cursor: { ...c }, progress: (c.chunks + c.skipped) / (c.chunks + c.skipped + left || 1) };
}

/** First pass done: whatever is still pending (low passages, the long tail) continues in the background. */
async function handOff(ctx: Ctx, c: Required<Cursor>) {
  const left = await ctx.convex.query(api.brainWorker.pendingCount, { spaceId: ctx.space._id });
  if (!left) return { done: true as const, summary: summary(c), next: [{ stage: "cascade" as const }] };
  await ctx.event("info", `First pass done. ${left}${left >= 300 ? "+" : ""} more passages keep enriching the brain in the background`, { progress: progressData(c) });
  return { done: true as const, summary: summary(c), next: [{ stage: "seed_brain" as const, detached: true }, { stage: "cascade" as const }] };
}

async function finish(ctx: Ctx, c: Required<Cursor>, firstPass: boolean) {
  if (firstPass) return handOff(ctx, c);
  return { done: true as const, summary: summary(c), next: [{ stage: "cascade" as const }] };
}

function summary(c: Required<Cursor>) {
  return `${c.chunks} passages read, ${c.created} facts extracted, ${c.skipped} passages skipped by triage${c.mode === "offline" ? " (offline stand-in)" : ""}`;
}

const progressData = (c: Required<Cursor>) => ({ chunks: c.chunks, total: c.total, entities: c.entities, facts: c.created, classified: c.classified, skipped: c.skipped, high: c.high, low: c.low });

async function commitPack(ctx: Ctx, pack: PendingChunk[], extraction: PackExtraction, c: Required<Cursor>) {
  if (ctx.lost()) return; // another worker owns the job now: never write
  const payload = await buildPackCommit(ctx, pack, extraction);
  if (ctx.lost()) return;
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
  const done = c.chunks + c.skipped;
  await ctx.progress(Math.min(0.99, done / Math.max(1, c.total, done)), { ...c });
  const titles = [...new Set(pack.map((p) => p.title).filter(Boolean))];
  await ctx.event(
    "info",
    `Read ${read} passages (${titles.slice(0, 2).join(", ")}${titles.length > 2 ? ` +${titles.length - 2} more` : ""}): ${facts} new facts, ${entities} new entities · ${c.created} facts so far · ${c.chunks} read, ${c.skipped} skipped of ${Math.max(c.total, done)}`,
    { mode: extraction.mode, progress: progressData(c) },
  );
}
