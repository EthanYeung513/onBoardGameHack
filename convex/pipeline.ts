import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { backoffMs, DEFAULT_MAX_ATTEMPTS, nextInScan, STAGE_LABELS, STALL_MS, type StageName } from "./lib/stages";
import { workerMutation, workerQuery } from "./lib/worker";
import { level, stageName } from "./schema";

// Sliced pipeline jobs (BUILD-CONTRACT "The pipeline is the unit of long work"), Convex side.
// State lives in `jobs`; the Node worker claims a job, runs one slice, heartbeats every ~3 s and
// reports the outcome. Retries back off ≤3 times; the watchdog cron marks silent jobs stalled;
// a manager resumes them and the cursor makes the stage skip work it already finished.

type JobTarget = { spaceId: Id<"spaces">; scanId?: Id<"scans">; connectorId?: Id<"connectors"> };

/** Queue a stage unless the same stage is already queued/running for the same target. */
export async function enqueue(ctx: MutationCtx, target: JobTarget, stage: StageName, cursor: unknown = {}) {
  const existing = await ctx.db
    .query("jobs")
    .withIndex("by_space", (q) => q.eq("spaceId", target.spaceId))
    .filter((q) =>
      q.and(
        q.eq(q.field("stage"), stage),
        q.eq(q.field("scanId"), target.scanId),
        q.eq(q.field("connectorId"), target.connectorId),
        q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running")),
      ),
    )
    .first();
  if (existing) return existing._id;
  return await ctx.db.insert("jobs", {
    ...target,
    stage,
    status: "queued",
    progress: 0,
    attempt: 0,
    cursor,
    runAfter: Date.now(),
  });
}

async function logEvent(ctx: MutationCtx, job: Doc<"jobs">, lvl: Doc<"job_events">["level"], message: string, data?: unknown) {
  await ctx.db.insert("job_events", { jobId: job._id, spaceId: job.spaceId, scanId: job.scanId, stage: job.stage, level: lvl, message, data });
}

async function setScanOutcome(ctx: MutationCtx, job: Doc<"jobs">, outcome: "succeeded" | "failed", error?: string) {
  if (!job.scanId) return;
  await ctx.db.patch(job.scanId, { status: outcome, error, ...(outcome === "succeeded" ? { progress: 1 } : {}) });
  await ctx.db.patch(job.spaceId, { status: outcome === "succeeded" ? "ready" : "error" });
}

// ---- worker API ---------------------------------------------------------------------------

/** Count of queued jobs; the worker subscribes to this to wake up immediately. */
export const pending = workerQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("jobs").withIndex("by_status_run", (q) => q.eq("status", "queued")).take(100)).length,
});

export const claim = workerMutation({
  args: { workerId: v.string(), stages: v.array(stageName) },
  handler: async (ctx, { workerId, stages }) => {
    const now = Date.now();
    const ready = await ctx.db
      .query("jobs")
      .withIndex("by_status_run", (q) => q.eq("status", "queued").lte("runAfter", now))
      .take(50);
    const job = ready.find((j) => stages.includes(j.stage));
    if (!job) return null;
    await ctx.db.patch(job._id, { status: "running", workerId, heartbeatAt: now, startedAt: job.startedAt ?? now, error: undefined });
    if (!job.startedAt) await logEvent(ctx, job, "info", `${STAGE_LABELS[job.stage]} started`);
    const space = await ctx.db.get(job.spaceId);
    const scan = job.scanId ? await ctx.db.get(job.scanId) : null;
    const connector = job.connectorId ? await ctx.db.get(job.connectorId) : null;
    return { job: { ...job, status: "running" as const, workerId }, space, scan, connector };
  },
});

/** Returns `{ lost: true }` if another worker took the job (e.g. after a stall) — stop work then. */
export const heartbeat = workerMutation({
  args: { jobId: v.id("jobs"), workerId: v.string(), progress: v.number(), cursor: v.optional(v.any()) },
  handler: async (ctx, { jobId, workerId, progress, cursor }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running" || job.workerId !== workerId) return { lost: true };
    await ctx.db.patch(jobId, { heartbeatAt: Date.now(), progress: Math.max(0, Math.min(1, progress)), ...(cursor !== undefined ? { cursor } : {}) });
    return { lost: false };
  },
});

export const event = workerMutation({
  args: { jobId: v.id("jobs"), level, message: v.string(), data: v.optional(v.any()) },
  handler: async (ctx, { jobId, level: lvl, message, data }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return fail(404, "Job not found");
    await logEvent(ctx, job, lvl, message, data);
  },
});

const nextJob = v.object({ stage: stageName, cursor: v.optional(v.any()) });

export const finish = workerMutation({
  args: {
    jobId: v.id("jobs"),
    workerId: v.string(),
    outcome: v.union(
      v.object({ kind: v.literal("done"), summary: v.optional(v.string()), next: v.optional(v.array(nextJob)) }),
      v.object({ kind: v.literal("continue"), cursor: v.any(), progress: v.number() }),
      v.object({ kind: v.literal("error"), message: v.string(), maxAttempts: v.optional(v.number()) }),
    ),
  },
  handler: async (ctx, { jobId, workerId, outcome }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.workerId !== workerId || job.status !== "running") return { lost: true };
    const now = Date.now();
    const label = STAGE_LABELS[job.stage];

    if (outcome.kind === "continue") {
      await ctx.db.patch(jobId, { status: "queued", cursor: outcome.cursor, progress: outcome.progress, heartbeatAt: now, runAfter: now });
      return { lost: false };
    }

    if (outcome.kind === "error") {
      const attempt = job.attempt + 1;
      const max = outcome.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
      if (attempt < max) {
        const delay = backoffMs(attempt);
        await ctx.db.patch(jobId, { status: "queued", attempt, error: outcome.message, runAfter: now + delay });
        await logEvent(ctx, job, "warn", `${label} failed (attempt ${attempt} of ${max}), retrying in ${delay / 1000}s: ${outcome.message}`);
      } else {
        await ctx.db.patch(jobId, { status: "failed", attempt, error: outcome.message, finishedAt: now });
        await logEvent(ctx, job, "error", `${label} failed after ${attempt} attempts: ${outcome.message}`);
        await setScanOutcome(ctx, job, "failed", outcome.message);
      }
      return { lost: false };
    }

    await ctx.db.patch(jobId, { status: "succeeded", progress: 1, finishedAt: now, heartbeatAt: now, error: undefined });
    await logEvent(ctx, job, "info", `${label} finished${outcome.summary ? `: ${outcome.summary}` : ""}`);
    const target = { spaceId: job.spaceId, scanId: job.scanId, connectorId: job.connectorId };
    const explicit = outcome.next;
    const chained = job.scanId ? nextInScan(job.stage) : null;
    const next = explicit ?? (chained ? [{ stage: chained, cursor: {} }] : []);
    for (const n of next) await enqueue(ctx, target, n.stage, n.cursor ?? {});
    if (job.stage === "ready") await setScanOutcome(ctx, job, "succeeded");
    else if (job.scanId) {
      const scan = await ctx.db.get(job.scanId);
      if (scan) await ctx.db.patch(job.scanId, { progress: Math.max(scan.progress, progressOf(job.stage)) });
    }
    return { lost: false };
  },
});

function progressOf(stage: StageName): number {
  const order: StageName[] = ["crawl", "extract_design", "analyse", "seed_brain", "generate_courses", "ready"];
  const i = order.indexOf(stage);
  return i < 0 ? 0 : (i + 1) / order.length;
}

// ---- watchdog + manager controls ----------------------------------------------------------

export const watchdog = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALL_MS;
    const running = await ctx.db.query("jobs").withIndex("by_status", (q) => q.eq("status", "running")).take(200);
    let stalled = 0;
    for (const job of running) {
      if ((job.heartbeatAt ?? 0) >= cutoff) continue;
      await ctx.db.patch(job._id, { status: "stalled", error: "No heartbeat for over 60 seconds", workerId: undefined });
      await logEvent(ctx, job, "warn", `${STAGE_LABELS[job.stage]} stalled: no heartbeat for over 60 seconds. Resume to continue.`);
      stalled++;
    }
    return stalled;
  },
});

/** Retry a failed job or resume a stalled one from its saved cursor (no completed work repeats). */
export const resume = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return fail(404, "Job not found");
    const { userId } = await requireRole(ctx, job.spaceId, MANAGERS);
    if (job.status !== "failed" && job.status !== "stalled") return fail(409, "Only failed or stalled steps can be resumed");
    await ctx.db.patch(jobId, { status: "queued", runAfter: Date.now(), error: undefined, ...(job.status === "failed" ? { attempt: 0 } : {}) });
    if (job.scanId) {
      await ctx.db.patch(job.scanId, { status: "running", error: undefined });
      await ctx.db.patch(job.spaceId, { status: "scanning" });
    }
    await logEvent(ctx, job, "info", `Resuming ${STAGE_LABELS[job.stage]}`);
    await audit(ctx, job.spaceId, `user:${userId}`, "job.resumed", { jobId, stage: job.stage, from: job.status });
  },
});

// ---- read side for the scan screen (F7) ---------------------------------------------------

export const scanStatus = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return fail(404, "Scan not found");
    await requireRole(ctx, scan.spaceId, MANAGERS);
    const jobs = await ctx.db.query("jobs").withIndex("by_scan", (q) => q.eq("scanId", scanId)).collect();
    const events = await ctx.db
      .query("job_events")
      .withIndex("by_scan", (q) => q.eq("scanId", scanId))
      .order("desc")
      .take(200);
    const stalled = jobs.some((j) => j.status === "running" && (j.heartbeatAt ?? 0) < Date.now() - STALL_MS);
    return {
      scan,
      jobs: jobs.map((j) => ({ id: j._id, stage: j.stage, label: STAGE_LABELS[j.stage], status: j.status, progress: j.progress, attempt: j.attempt, error: j.error ?? null })),
      events: events.reverse().map((e) => ({ id: e._id, at: e._creationTime, stage: e.stage, level: e.level, message: e.message })),
      stalled,
    };
  },
});
