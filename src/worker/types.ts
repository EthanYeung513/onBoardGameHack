import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { Doc } from "@convex/_generated/dataModel";
import type { StageName } from "@convex/lib/stages";
import type { Embedder } from "./providers/embed";
import type { Llm } from "./providers/llm";

export type Level = "debug" | "info" | "warn" | "error";

/** Convex function references the worker may call: `secret` is filled in by the client. */
type WorkerFn<T extends "query" | "mutation"> = FunctionReference<T, "public", { secret: string } & Record<string, unknown>>;
export type WorkerArgs<F extends WorkerFn<"query" | "mutation">> = Omit<FunctionArgs<F>, "secret">;

export interface WorkerConvex {
  query<F extends WorkerFn<"query">>(fn: F, args: WorkerArgs<F>): Promise<FunctionReturnType<F>>;
  mutation<F extends WorkerFn<"mutation">>(fn: F, args: WorkerArgs<F>): Promise<FunctionReturnType<F>>;
}

export interface StageContext {
  job: Doc<"jobs">;
  space: Doc<"spaces">;
  scan: Doc<"scans"> | null;
  connector: Doc<"connectors"> | null;
  convex: WorkerConvex;
  llm: Llm;
  embed: Embedder;
  /** Milliseconds left in this slice; return `{ done: false, cursor }` before it runs out. */
  remainingMs(): number;
  event(level: Level, message: string, data?: Record<string, unknown>): Promise<void>;
  /** Saves progress (0..1) and, optionally, the resume cursor. */
  progress(value: number, cursor?: Record<string, unknown>): Promise<void>;
  /** True once another worker took the job over (after a stall) — stop writing. */
  lost(): boolean;
}

export type SliceResult =
  | { done: true; summary?: string; next?: { stage: StageName; cursor?: Record<string, unknown> }[] }
  | { done: false; cursor: Record<string, unknown>; progress: number };

export interface StageDefinition {
  name: StageName;
  maxAttempts?: number;
  run(ctx: StageContext): Promise<SliceResult>;
}
