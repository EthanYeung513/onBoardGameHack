import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Embedder } from "./providers/embed";
import type { Llm } from "./providers/llm";
import type { StageContext, StageDefinition, WorkerConvex } from "./types";

// Runs one claimed slice: heartbeat every ~3 s, a fixed time budget, then report the outcome.
// Retry/backoff, stall detection and chaining to the next stage live in convex/pipeline.ts.

export const SLICE_BUDGET_MS = 45_000;
export const HEARTBEAT_MS = 3_000;

export type Claimed = NonNullable<FunctionReturnType<typeof api.pipeline.claim>>;

export interface RunnerDeps {
  convex: WorkerConvex;
  llm: Llm;
  embed: Embedder;
  workerId: string;
  registry: Partial<Record<string, StageDefinition>>;
  budgetMs?: number;
  heartbeatMs?: number;
}

export async function runSlice(claimed: Claimed, deps: RunnerDeps): Promise<"done" | "continue" | "error" | "lost"> {
  const { job, space, scan, connector } = claimed;
  const def = deps.registry[job.stage];
  const jobId = job._id;
  const t0 = Date.now();
  const budget = deps.budgetMs ?? SLICE_BUDGET_MS;
  let progress = job.progress;
  let cursor: Record<string, unknown> | undefined;
  let lost = false;

  const beat = setInterval(() => {
    deps.convex
      .mutation(api.pipeline.heartbeat, { jobId, workerId: deps.workerId, progress, cursor })
      .then((r) => {
        if (r.lost) lost = true;
      })
      .catch(() => undefined);
  }, deps.heartbeatMs ?? HEARTBEAT_MS);

  const ctx: StageContext = {
    job,
    space: space!,
    scan,
    connector,
    convex: deps.convex,
    llm: deps.llm,
    embed: deps.embed,
    remainingMs: () => budget - (Date.now() - t0),
    lost: () => lost,
    event: async (level, message, data) => {
      await deps.convex.mutation(api.pipeline.event, { jobId, level, message, data });
    },
    progress: async (value, c) => {
      progress = Math.max(0, Math.min(1, value));
      if (c) cursor = { ...c };
      const r = await deps.convex.mutation(api.pipeline.heartbeat, { jobId, workerId: deps.workerId, progress, cursor });
      if (r.lost) lost = true;
    },
  };

  try {
    if (!def) throw new Error(`No worker handler is registered for stage "${job.stage}"`);
    if (!space) throw new Error("The space for this job no longer exists");
    const result = await def.run(ctx);
    clearInterval(beat);
    if (lost) return "lost";
    const outcome = result.done
      ? { kind: "done" as const, summary: result.summary, next: result.next }
      : { kind: "continue" as const, cursor: result.cursor, progress: result.progress };
    const r = await deps.convex.mutation(api.pipeline.finish, { jobId, workerId: deps.workerId, outcome });
    return r.lost ? "lost" : result.done ? "done" : "continue";
  } catch (err) {
    clearInterval(beat);
    const message = err instanceof Error ? err.message : String(err);
    const maxAttempts = (err as { code?: number }).code === 503 ? 1 : (def?.maxAttempts ?? 3);
    await deps.convex.mutation(api.pipeline.finish, { jobId, workerId: deps.workerId, outcome: { kind: "error", message: message.slice(0, 500), maxAttempts } });
    return "error";
  }
}
