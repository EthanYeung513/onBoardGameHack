import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { FULL_SYNC_EVERY_MS } from "@convex/lib/connectors";
import { driveSyncer } from "../connectors/drive";
import { filesSyncer } from "../connectors/files";
import { githubSyncer } from "../connectors/github";
import { ConnectorAuthError, createHttp, nangoHttp, type FetchFn, type Http } from "../connectors/http";
import { jiraSyncer } from "../connectors/jira";
import { notionSyncer } from "../connectors/notion";
import { slackSyncer } from "../connectors/slack";
import type { SyncEnv, Syncer, Task } from "../connectors/types";
import { ingestDocument } from "../ingest";
import type { SliceResult, StageContext, StageDefinition } from "../types";

// `sync_connector` (F9–F13, F34): one connector's upstream → ingestDocument → diff_events → stale
// cascade. Sliced and resumable: the task queue lives in the job cursor. Incremental where the API
// allows (connector.cursor.since); a full re-enumeration with removal sweep runs on connect,
// on "Sync now" and at least daily. Any added/changed/removed item chains seed_brain + cascade.

export const SYNCERS: Partial<Record<Doc<"connectors">["type"], Syncer>> = {
  github: githubSyncer,
  files: filesSyncer,
  slack: slackSyncer,
  jira: jiraSyncer,
  notion: notionSyncer,
  drive: driveSyncer,
};

type Counts = { added: number; changed: number; unchanged: number; removed: number };
interface DriverCursor {
  startedAt: number;
  since: string | null;
  queue: Task[];
  done: number;
  items: number;
  counts: Counts;
  sweep: string[];
  capped: boolean;
}
type ConnectorCursor = { since?: string; lastFullAt?: number };

/** Slices stop with this much budget left so the final report never races the deadline. */
const RESERVE_MS = 8_000;

export interface SyncDeps {
  syncers?: Partial<Record<Doc<"connectors">["type"], Syncer>>;
  fetch?: FetchFn;
  now?: () => number;
}

async function httpFor(ctx: StageContext, connector: Doc<"connectors">, fetchFn?: FetchFn): Promise<Http> {
  if (connector.type === "files") return createHttp({ service: "files", baseUrl: "", headers: {}, fetch: fetchFn });
  const cred = await ctx.convex.query(api.connectors.credential, { connectorId: connector._id });
  if (!cred) throw new ConnectorAuthError(`${connector.type} is not connected (no stored credential). Connect it from the Tools tab.`);
  if (connector.type === "github") {
    return createHttp({
      service: "GitHub",
      baseUrl: "https://api.github.com",
      fetch: fetchFn,
      headers: { Authorization: `Bearer ${cred.secret}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "orthogonal-connector" },
    });
  }
  const parsed = JSON.parse(cred.secret) as { connectionId: string; providerConfigKey: string };
  return nangoHttp(connector.type, parsed, fetchFn);
}

export async function runSync(ctx: StageContext, deps: SyncDeps = {}): Promise<SliceResult> {
  const connector = ctx.connector;
  if (!connector) throw new Error("sync_connector job has no connector");
  const syncer = (deps.syncers ?? SYNCERS)[connector.type];
  if (!syncer) throw new ConnectorAuthError(`Syncing ${connector.type} isn't available yet`);
  const now = deps.now ?? Date.now;
  const connectorId = connector._id as Id<"connectors">;
  const http = await httpFor(ctx, connector, deps.fetch);

  const prev = (connector.cursor ?? {}) as ConnectorCursor;
  const jobCursor = (ctx.job.cursor ?? {}) as Partial<DriverCursor> & { full?: boolean };
  let cur: DriverCursor;
  const env: SyncEnv = {
    connector,
    since: null,
    http,
    known: async (prefix) => new Map((await ctx.convex.query(api.connectors.knownItems, { connectorId, prefix })).map((k) => [k.externalId, k.rev])),
    event: (level, message, data) => ctx.event(level, message, data),
    fileUrl: (storageId) => ctx.convex.query(api.connectors.fileUrl, { storageId: storageId as Id<"_storage"> }),
    fileDone: async (storageId) => void (await ctx.convex.mutation(api.connectors.fileDone, { connectorId, storageId: storageId as Id<"_storage"> })),
  };

  if (jobCursor.startedAt) {
    cur = jobCursor as DriverCursor;
    env.since = cur.since;
  } else {
    const startedAt = now();
    const full = Boolean(jobCursor.full) || !prev.since || !prev.lastFullAt || startedAt - prev.lastFullAt > FULL_SYNC_EVERY_MS;
    env.since = full ? null : (prev.since ?? null);
    await ctx.convex.mutation(api.connectors.setSyncState, { connectorId, status: "syncing" });
    cur = { startedAt, since: env.since, queue: await syncer.start(env), done: 0, items: 0, counts: { added: 0, changed: 0, unchanged: 0, removed: 0 }, sweep: [], capped: false };
    await ctx.event("info", `${syncer.service}: ${full ? "full" : "incremental"} sync started`, { since: env.since });
  }

  while (cur.queue.length && ctx.remainingMs() > RESERVE_MS && !ctx.lost()) {
    const task = cur.queue[0];
    const r = await syncer.run(task, env);
    for (const doc of r.docs ?? []) {
      if (cur.items >= syncer.maxItems) {
        cur.capped = true;
        break;
      }
      const res = await ingestDocument(ctx, { ...doc, connectorId });
      cur.counts[res.status]++;
      cur.items++;
    }
    if (r.touch?.length) await ctx.convex.mutation(api.connectors.touchItems, { connectorId, externalIds: r.touch });
    await r.after?.();
    cur.queue.shift();
    cur.done++;
    if (r.capped) cur.capped = true;
    cur.sweep.push(...(r.sweep ?? []));
    if (cur.items >= syncer.maxItems) {
      if (cur.queue.length || (r.tasks ?? []).length) cur.capped = true;
      cur.queue = [];
    } else cur.queue.push(...(r.tasks ?? []));
    await ctx.progress(cur.done / (cur.done + cur.queue.length), cur as unknown as Record<string, unknown>);
  }

  if (cur.queue.length) {
    return { done: false, cursor: cur as unknown as Record<string, unknown>, progress: cur.done / (cur.done + cur.queue.length) };
  }

  // Removal sweep: only scopes the connector fully enumerated, and never after an item cap.
  if (!cur.capped) {
    for (const prefix of cur.sweep) {
      const { removed } = await ctx.convex.mutation(api.ingest.sweepRemoved, { spaceId: ctx.space._id, connectorId, before: cur.startedAt, prefix });
      cur.counts.removed += removed;
    }
  }

  const full = cur.since === null;
  const summary = { ...cur.counts, items: cur.items, capped: cur.capped, mode: full ? "full" : "incremental" };
  await ctx.convex.mutation(api.connectors.setSyncState, {
    connectorId,
    status: "ready",
    lastSyncedAt: now(),
    cursor: { since: new Date(cur.startedAt).toISOString(), lastFullAt: full ? cur.startedAt : prev.lastFullAt } satisfies ConnectorCursor,
    summary,
  });
  const changes = cur.counts.added + cur.counts.changed + cur.counts.removed;
  const text = `${syncer.service}: ${cur.counts.added} new, ${cur.counts.changed} changed, ${cur.counts.removed} removed, ${cur.counts.unchanged} unchanged${cur.capped ? " (capped)" : ""}`;
  await ctx.event("info", text, summary);
  return { done: true, summary: text, next: changes ? [{ stage: "seed_brain" }, { stage: "cascade" }] : undefined };
}

export const syncConnectorStage: StageDefinition = {
  name: "sync_connector",
  maxAttempts: 3,
  run: (ctx) => runSync(ctx),
};
