import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { nextStage, ORDER, stage } from "./registry";
import type { JobRow, Level, ProjectRow, StageContext, StageName } from "./types";

// Runs one slice of the current stage per invocation. State lives in `jobs`, so any invocation
// can pick up where the last one stopped, and a stalled job can be resumed safely.

export const STALL_MS = 60_000;
export const SLICE_BUDGET_MS = 40_000;
const HEARTBEAT_MS = 3_000;

export function pipelineSecret(): string {
  return createHash("sha256").update(`${env().SUPABASE_SERVICE_ROLE_KEY ?? "dev"}:pipeline`).digest("hex");
}

export async function logEvent(db: SupabaseClient, job: Pick<JobRow, "id" | "project_id">, level: Level, message: string, data?: Record<string, unknown>) {
  const { error } = await db.from("job_events").insert({ job_id: job.id, project_id: job.project_id, level, message, data: data ?? null });
  if (error) console.error("job_events insert failed", error.message);
}

export async function ensureJob(db: SupabaseClient, projectId: string, name: StageName): Promise<JobRow> {
  const { data, error } = await db
    .from("jobs")
    .upsert({ project_id: projectId, stage: name }, { onConflict: "project_id,stage", ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data as JobRow;
  const existing = await db.from("jobs").select().eq("project_id", projectId).eq("stage", name).single();
  if (existing.error) throw new Error(existing.error.message);
  return existing.data as JobRow;
}

/** Marks running jobs with an old heartbeat as stalled. Called on every status read. */
export async function watchdog(db: SupabaseClient, projectId: string): Promise<number> {
  const cutoff = new Date(Date.now() - STALL_MS).toISOString();
  const { data } = await db.from("jobs").update({ status: "stalled", error: "No heartbeat for over 60 seconds" }).eq("project_id", projectId).eq("status", "running").lt("heartbeat_at", cutoff).select("id, project_id, stage");
  for (const j of data ?? []) {
    await logEvent(db, j, "warn", `Stage ${j.stage} stalled: no heartbeat for over 60 seconds. Resume to continue.`);
    await db.from("projects").update({ status: "stalled" }).eq("id", projectId);
  }
  return data?.length ?? 0;
}

export type AdvanceResult =
  | { state: "busy" | "waiting" | "ready" | "failed" | "retry_scheduled"; stage: StageName; retryInMs?: number }
  | { state: "continue"; stage: StageName };

/** Runs one slice. Returns "continue" when the caller should schedule another invocation. */
export async function advance(projectId: string, opts: { resume?: boolean } = {}): Promise<AdvanceResult> {
  const db = supabaseAdmin();
  const p = await db.from("projects").select().eq("id", projectId).single();
  if (p.error) throw new Error(p.error.message);
  const project = p.data as ProjectRow;
  const def = stage(project.stage);
  const job = await ensureJob(db, projectId, project.stage);

  if (job.status === "succeeded" && project.stage === "ready") return { state: "ready", stage: project.stage };
  if (job.status === "failed" && !opts.resume) return { state: "failed", stage: project.stage };
  if (def.waitsForUser) {
    if (job.status !== "waiting") {
      await db.from("jobs").update({ status: "waiting", started_at: job.started_at ?? new Date().toISOString(), progress: 0 }).eq("id", job.id);
      await db.from("projects").update({ status: "waiting", updated_at: new Date().toISOString() }).eq("id", projectId);
      await logEvent(db, job, "info", def.description);
    }
    return { state: "waiting", stage: project.stage };
  }
  const retryAt = typeof job.cursor.retry_at === "string" ? Date.parse(job.cursor.retry_at) : 0;
  if (retryAt > Date.now() && !opts.resume) return { state: "retry_scheduled", stage: project.stage, retryInMs: retryAt - Date.now() };

  // Take the lock: only one invocation may run a job, unless the holder has gone silent.
  const cutoff = new Date(Date.now() - STALL_MS).toISOString();
  const now = new Date().toISOString();
  const resetAttempts = opts.resume && job.status === "failed";
  const lock = await db
    .from("jobs")
    .update({ status: "running", heartbeat_at: now, started_at: job.started_at ?? now, error: null, ...(resetAttempts ? { attempt: 0 } : {}) })
    .eq("id", job.id)
    .or(`status.neq.running,heartbeat_at.lt.${cutoff},heartbeat_at.is.null`)
    .select()
    .maybeSingle();
  if (lock.error) throw new Error(lock.error.message);
  if (!lock.data) return { state: "busy", stage: project.stage };
  const locked = lock.data as JobRow;
  await db.from("projects").update({ status: "running", updated_at: now }).eq("id", projectId);
  if (job.status === "stalled") await logEvent(db, locked, "info", `Resuming ${def.label} after a stall`);
  if (!job.heartbeat_at) await logEvent(db, locked, "info", `${def.label} started`);

  const t0 = Date.now();
  let progress = locked.progress;
  let cursor = locked.cursor;
  const beat = setInterval(() => {
    void db.from("jobs").update({ heartbeat_at: new Date().toISOString(), progress }).eq("id", locked.id).then(() => undefined);
  }, HEARTBEAT_MS);
  const ctx: StageContext = {
    project,
    job: locked,
    db,
    remainingMs: () => SLICE_BUDGET_MS - (Date.now() - t0),
    event: (level, message, data) => logEvent(db, locked, level, message, data),
    progress: async (value, c) => {
      progress = Math.max(0, Math.min(1, value));
      if (c) cursor = { ...c };
      await db.from("jobs").update({ progress, heartbeat_at: new Date().toISOString(), ...(c ? { cursor } : {}) }).eq("id", locked.id);
    },
  };

  try {
    const result = await def.run(ctx);
    clearInterval(beat);
    if ("wait" in result) {
      await db.from("jobs").update({ status: "waiting", heartbeat_at: new Date().toISOString() }).eq("id", locked.id);
      await db.from("projects").update({ status: "waiting" }).eq("id", projectId);
      return { state: "waiting", stage: project.stage };
    }
    if (!result.done) {
      await db.from("jobs").update({ status: "queued", progress: result.progress, cursor: result.cursor, heartbeat_at: new Date().toISOString() }).eq("id", locked.id);
      return { state: "continue", stage: project.stage };
    }
    const finished = new Date().toISOString();
    await db.from("jobs").update({ status: "succeeded", progress: 1, finished_at: finished, heartbeat_at: finished, error: null }).eq("id", locked.id);
    await logEvent(db, locked, "info", `${def.label} finished${result.summary ? `: ${result.summary}` : ""}`, { ms: Date.now() - t0 });
    const next = nextStage(project.stage);
    if (!next) {
      await db.from("projects").update({ status: "ready", updated_at: finished }).eq("id", projectId);
      return { state: "ready", stage: project.stage };
    }
    await ensureJob(db, projectId, next);
    await db.from("projects").update({ stage: next, status: "running", updated_at: finished }).eq("id", projectId);
    return { state: "continue", stage: next };
  } catch (err) {
    clearInterval(beat);
    const message = err instanceof Error ? err.message : String(err);
    const attempt = locked.attempt + 1;
    if (attempt < def.maxAttempts) {
      const delay = 2000 * 2 ** (attempt - 1);
      await db.from("jobs").update({ status: "queued", attempt, error: message, cursor: { ...cursor, retry_at: new Date(Date.now() + delay).toISOString() } }).eq("id", locked.id);
      await logEvent(db, locked, "warn", `${def.label} failed (attempt ${attempt} of ${def.maxAttempts}), retrying in ${delay / 1000}s: ${message}`);
      return { state: "retry_scheduled", stage: project.stage, retryInMs: delay };
    }
    await db.from("jobs").update({ status: "failed", attempt, error: message, finished_at: new Date().toISOString() }).eq("id", locked.id);
    await db.from("projects").update({ status: "failed" }).eq("id", projectId);
    await logEvent(db, locked, "error", `${def.label} failed after ${attempt} attempts: ${message}`);
    return { state: "failed", stage: project.stage };
  }
}

/** Moves a waiting project past its user gate. */
export async function releaseGate(projectId: string, gate: "awaiting_confirmation" | "awaiting_answers") {
  const db = supabaseAdmin();
  const p = await db.from("projects").select("stage").eq("id", projectId).single();
  if (p.error) throw new Error(p.error.message);
  if (p.data.stage !== gate) return false;
  const job = await ensureJob(db, projectId, gate);
  const now = new Date().toISOString();
  await db.from("jobs").update({ status: "succeeded", progress: 1, finished_at: now, heartbeat_at: now }).eq("id", job.id);
  await logEvent(db, job, "info", gate === "awaiting_confirmation" ? "Findings confirmed" : "Answers saved");
  const next = nextStage(gate)!;
  await ensureJob(db, projectId, next);
  await db.from("projects").update({ stage: next, status: "running", updated_at: now }).eq("id", projectId);
  return true;
}

/** Rewinds a project to an earlier stage, for example to regenerate flows. */
export async function rewind(projectId: string, to: StageName) {
  const db = supabaseAdmin();
  const idx = ORDER.indexOf(to);
  const later = ORDER.slice(idx);
  await db.from("jobs").update({ status: "queued", progress: 0, attempt: 0, cursor: {}, error: null, finished_at: null, heartbeat_at: null }).eq("project_id", projectId).in("stage", later);
  await db.from("projects").update({ stage: to, status: "running" }).eq("id", projectId);
}
