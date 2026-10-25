import type { Doc } from "../_generated/dataModel";

// Pure connector rules shared by Convex (cron, mutations), the worker and the Tools tab.

export type ConnectorType = Doc<"connectors">["type"];

/** F34: how often a `ready` connector re-syncs. Files have no upstream; webapp is P2. */
export const SYNC_INTERVAL_MS: Partial<Record<ConnectorType, number>> = {
  github: 15 * 60_000,
  slack: 15 * 60_000,
  jira: 15 * 60_000,
  notion: 15 * 60_000,
  drive: 15 * 60_000,
  linear: 15 * 60_000,
  website: 24 * 60 * 60_000,
};

/** A full re-enumeration (and removal sweep) at most this often; syncs in between are incremental. */
export const FULL_SYNC_EVERY_MS = 24 * 60 * 60_000;

export function syncIntervalMs(c: Pick<Doc<"connectors">, "type" | "config">): number | null {
  const override = (c.config as { intervalMs?: unknown } | undefined)?.intervalMs;
  if (typeof override === "number" && override >= 60_000) return override;
  return SYNC_INTERVAL_MS[c.type] ?? null;
}

/** True when the scheduler should enqueue a sync for this connector now. */
export function isDue(c: Pick<Doc<"connectors">, "type" | "status" | "config" | "lastSyncedAt" | "authRef" | "_creationTime">, now: number): boolean {
  if (c.status !== "ready") return false;
  if (c.type !== "website" && !c.authRef) return false;
  const interval = syncIntervalMs(c);
  if (interval === null) return false;
  return now - (c.lastSyncedAt ?? c._creationTime) >= interval;
}

/** Nango provider names per connector type (matched against the account's configured integrations). */
export const NANGO_PROVIDERS: Partial<Record<ConnectorType, string[]>> = {
  slack: ["slack"],
  jira: ["jira"],
  notion: ["notion"],
  drive: ["google-drive", "google-docs", "google"],
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const UPLOAD_EXTENSIONS = ["pdf", "md", "markdown", "txt", "docx"] as const;

export function uploadExtension(name: string): (typeof UPLOAD_EXTENSIONS)[number] | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return (UPLOAD_EXTENSIONS as readonly string[]).includes(ext) ? (ext as (typeof UPLOAD_EXTENSIONS)[number]) : null;
}
