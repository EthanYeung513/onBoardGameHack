import type { SupabaseClient } from "@supabase/supabase-js";

export const STAGES = [
  "crawl",
  "extract_design",
  "analyse",
  "awaiting_confirmation",
  "ask_questions",
  "awaiting_answers",
  "generate_flows",
  "validate",
  "ready",
] as const;
export type StageName = (typeof STAGES)[number];

export type Level = "debug" | "info" | "warn" | "error";

export interface ProjectRow {
  id: string;
  url: string;
  name: string | null;
  status: string;
  stage: StageName;
  reused_crawl_from: string | null;
  created_by: string;
}

export interface JobRow {
  id: string;
  project_id: string;
  stage: StageName;
  status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "stalled";
  progress: number;
  attempt: number;
  cursor: Record<string, unknown>;
  heartbeat_at: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface StageContext {
  project: ProjectRow;
  job: JobRow;
  db: SupabaseClient;
  /** Milliseconds left in this invocation's budget. */
  remainingMs(): number;
  event(level: Level, message: string, data?: Record<string, unknown>): Promise<void>;
  progress(value: number, cursor?: Record<string, unknown>): Promise<void>;
}

/**
 * A stage runs in slices. `done: false` means more slices are needed and the cursor is kept;
 * `wait: true` parks the pipeline until a user action resumes it.
 */
export type SliceResult = { done: true; summary?: string } | { done: false; cursor: Record<string, unknown>; progress: number } | { wait: true; summary?: string };

export interface StageDefinition {
  name: StageName;
  label: string;
  description: string;
  maxAttempts: number;
  /** Stages the user must act on are marked waiting and are not auto advanced. */
  waitsForUser?: boolean;
  run(ctx: StageContext): Promise<SliceResult>;
}
