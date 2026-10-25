import type { Doc } from "@convex/_generated/dataModel";
import type { IngestDoc } from "../ingest";
import type { Level } from "../types";
import type { Http } from "./http";

// A connector sync is a queue of small JSON tasks ("list repos", "fetch this blob", "read this
// channel"), persisted in the job cursor so a crashed or sliced sync resumes where it stopped.

export type Task = { kind: string } & Record<string, unknown>;

export type SyncDoc = Omit<IngestDoc, "connectorId">;

export interface TaskResult {
  docs?: SyncDoc[];
  tasks?: Task[];
  /** Items seen upstream at the same revision: refresh `fetchedAt` without refetching. */
  touch?: string[];
  /** Fully enumerated scopes (externalId prefixes): anything there not seen this sync was removed. */
  sweep?: string[];
  /** The scope hit a cap / truncation (reported in the sync summary; such scopes emit no sweep). */
  capped?: boolean;
  /** Runs after the docs are ingested (e.g. drop a processed upload from the queue). */
  after?: () => Promise<void>;
}

export interface SyncEnv {
  connector: Doc<"connectors">;
  /** ISO time of the last successful sync start, or null for a full sync. */
  since: string | null;
  http: Http;
  /** externalId → upstream revision (meta.rev) for this connector's items under `prefix`. */
  known(prefix: string): Promise<Map<string, string | null>>;
  event(level: Level, message: string, data?: Record<string, unknown>): Promise<void>;
  /** Worker-only Convex helpers some connectors need (file URLs, upload queue). */
  fileUrl?(storageId: string): Promise<string | null>;
  fileDone?(storageId: string): Promise<void>;
}

export interface Syncer {
  /** Display name used in events and readable errors. */
  service: string;
  /** Per-sync cap on ingested items; hitting it disables the removal sweep. */
  maxItems: number;
  start(env: SyncEnv): Task[] | Promise<Task[]>;
  run(task: Task, env: SyncEnv): Promise<TaskResult>;
}
