import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { isDue, MAX_UPLOAD_BYTES, uploadExtension } from "./lib/connectors";
import { fail } from "./lib/errors";
import { workerMutation, workerQuery } from "./lib/worker";
import { enqueue, startScanJobs } from "./pipeline";
import { connectorStatus, connectorType } from "./schema";

// Tool connectors (PRD F9–F13, F34; BUILD-CONTRACT "Connector contract"). Status machine:
// pending → authing → syncing → ready | error | stale. Credentials live in the write-only
// `connector_credentials` table: only internal functions and the worker (WORKER_SECRET) read it;
// nothing public ever returns `secret` or `authRef`.

export type PendingFile = { storageId: Id<"_storage">; name: string; size: number };

/** The safe projection the Tools tab sees. */
function publicView(c: Doc<"connectors">) {
  const pending = ((c.config as { pending?: PendingFile[] } | undefined)?.pending ?? []).length;
  return { _id: c._id, type: c.type, status: c.status, label: c.label ?? null, lastSyncedAt: c.lastSyncedAt ?? null, error: c.error ?? null, connected: Boolean(c.authRef) || c.type === "files", pendingFiles: pending };
}

async function connectorFor(ctx: MutationCtx, spaceId: Id<"spaces">, type: Doc<"connectors">["type"]) {
  const existing = await ctx.db.query("connectors").withIndex("by_space_type", (q) => q.eq("spaceId", spaceId).eq("type", type)).first();
  if (existing) return existing;
  const id = await ctx.db.insert("connectors", { spaceId, type, status: "pending" });
  return (await ctx.db.get(id))!;
}

/** Queue a sync and flip the card to `syncing`. `full` forces re-enumeration + removal sweep. */
async function queueSync(ctx: MutationCtx, c: Doc<"connectors">, full: boolean) {
  await ctx.db.patch(c._id, { status: "syncing", error: undefined });
  return await enqueue(ctx, { spaceId: c.spaceId, connectorId: c._id }, "sync_connector", full ? { full: true } : {});
}

// ---- Tools tab (managers) -------------------------------------------------------------------

export const list = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const rows = await ctx.db.query("connectors").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    const facts = (await ctx.db.query("facts").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect()).filter((f) => f.status !== "rejected").length;
    return { connectors: rows.map(publicView), facts };
  },
});

/** Manual "Sync now" (F34): a full sync with removal sweep. */
export const syncNow = mutation({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, { connectorId }) => {
    const c = await ctx.db.get(connectorId);
    if (!c) return fail(404, "Connector not found");
    const { userId } = await requireRole(ctx, c.spaceId, MANAGERS);
    if (c.type !== "files" && c.type !== "website" && !c.authRef) return fail(409, "Connect this tool first");
    const jobId = await queueSync(ctx, c, true);
    await audit(ctx, c.spaceId, `user:${userId}`, "connector.sync_requested", { connectorId, type: c.type, jobId });
    return jobId;
  },
});

/** Disconnect: drop the credential (revoked at Nango best-effort), keep ingested items (frozen). */
export const disconnect = mutation({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, { connectorId }) => {
    const c = await ctx.db.get(connectorId);
    if (!c) return fail(404, "Connector not found");
    const { userId } = await requireRole(ctx, c.spaceId, MANAGERS);
    if (c.authRef) {
      const cred = await ctx.db.query("connector_credentials").withIndex("by_ref", (q) => q.eq("ref", c.authRef!)).first();
      if (cred) {
        if (cred.kind === "oauth") await ctx.scheduler.runAfter(0, internal.connectorAuth.revokeNango, { secret: cred.secret });
        await ctx.db.delete(cred._id);
      }
    }
    await ctx.db.patch(connectorId, { status: "pending", authRef: undefined, cursor: undefined, error: undefined });
    await audit(ctx, c.spaceId, `user:${userId}`, "connector.disconnected", { connectorId, type: c.type, itemsKept: true });
  },
});

/** The manager closed a connect window without finishing: back from `authing` to `pending`. */
export const cancelAuth = mutation({
  args: { spaceId: v.id("spaces"), type: connectorType },
  handler: async (ctx, { spaceId, type }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const c = await ctx.db.query("connectors").withIndex("by_space_type", (q) => q.eq("spaceId", spaceId).eq("type", type)).first();
    if (c && c.status === "authing" && !c.authRef) await ctx.db.patch(c._id, { status: "pending" });
  },
});

// ---- Upload docs (files connector) -------------------------------------------------------

export const generateUploadUrl = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    return await ctx.storage.generateUploadUrl();
  },
});

/** What the manager has uploaded: files still queued for reading, then docs already read (newest first). */
export const uploads = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const c = await ctx.db.query("connectors").withIndex("by_space_type", (q) => q.eq("spaceId", spaceId).eq("type", "files")).first();
    if (!c) return { pending: [], read: [] };
    const items = await ctx.db.query("source_items").withIndex("by_connector", (q) => q.eq("connectorId", c._id)).take(200);
    // The worker stores the doc a moment before it drops the upload from the queue: don't list it twice.
    const readBlobs = new Set(items.map((i) => (i.meta as { storageId?: string } | undefined)?.storageId));
    const pending = ((c.config as { pending?: PendingFile[] } | undefined)?.pending ?? []).filter((f) => !readBlobs.has(f.storageId)).map((f) => ({ name: f.name, size: f.size }));
    const read = items
      .filter((i) => !i.removedAt)
      .sort((a, b) => b.fetchedAt - a.fetchedAt)
      .map((i) => ({ _id: i._id, name: i.title, size: (i.meta as { size?: number } | undefined)?.size ?? null, readAt: i.fetchedAt }));
    return { pending, read };
  },
});

/** Register uploaded files (PDF/MD/DOCX/TXT ≤ 5 MB) and queue their parse + ingest. */
export const addFiles = mutation({
  args: { spaceId: v.id("spaces"), files: v.array(v.object({ storageId: v.id("_storage"), name: v.string() })) },
  handler: async (ctx, { spaceId, files }) => {
    const { userId } = await requireRole(ctx, spaceId, MANAGERS);
    const accepted: PendingFile[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const f of files) {
      const meta = await ctx.db.system.get(f.storageId);
      const reason = !meta ? "upload not found" : meta.size > MAX_UPLOAD_BYTES ? "larger than 5 MB" : !uploadExtension(f.name) ? "not a PDF, Markdown, DOCX or text file" : null;
      if (reason || !meta) {
        rejected.push({ name: f.name, reason: reason ?? "upload not found" });
        if (meta) await ctx.storage.delete(f.storageId);
        continue;
      }
      accepted.push({ storageId: f.storageId, name: f.name.slice(0, 200), size: meta.size });
    }
    if (accepted.length === 0) return { accepted: 0, rejected };
    const c = await connectorFor(ctx, spaceId, "files");
    const config = (c.config as { pending?: PendingFile[] } | undefined) ?? {};
    await ctx.db.patch(c._id, { label: "Uploaded docs", config: { ...config, pending: [...(config.pending ?? []), ...accepted] } });
    await queueSync(ctx, (await ctx.db.get(c._id))!, false);
    await audit(ctx, spaceId, `user:${userId}`, "connector.files_added", { connectorId: c._id, files: accepted.map((f) => f.name), rejected });
    return { accepted: accepted.length, rejected };
  },
});

// ---- internal: used by the auth actions in connectorAuth.ts ---------------------------------

export const assertManager = internalQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireRole(ctx, spaceId, MANAGERS);
    return userId;
  },
});

export const markAuthing = internalMutation({
  args: { spaceId: v.id("spaces"), type: connectorType },
  handler: async (ctx, { spaceId, type }) => {
    const c = await connectorFor(ctx, spaceId, type);
    if (!c.authRef) await ctx.db.patch(c._id, { status: "authing", error: undefined });
  },
});

export const markAuthFailed = internalMutation({
  args: { spaceId: v.id("spaces"), type: connectorType, error: v.string() },
  handler: async (ctx, { spaceId, type, error }) => {
    const c = await connectorFor(ctx, spaceId, type);
    if (!c.authRef) await ctx.db.patch(c._id, { status: "error", error });
  },
});

/** Stores the credential write-only, points the connector at it and queues the first (full) sync. */
export const saveCredential = internalMutation({
  args: {
    spaceId: v.id("spaces"),
    userId: v.id("users"),
    type: connectorType,
    kind: v.union(v.literal("pat"), v.literal("oauth")),
    secret: v.string(),
    label: v.string(),
    config: v.optional(v.any()),
  },
  handler: async (ctx, { spaceId, userId, type, kind, secret, label, config }) => {
    const c = await connectorFor(ctx, spaceId, type);
    if (c.authRef) {
      const old = await ctx.db.query("connector_credentials").withIndex("by_ref", (q) => q.eq("ref", c.authRef!)).first();
      if (old) await ctx.db.delete(old._id);
    }
    const ref = `cred_${crypto.randomUUID()}`;
    await ctx.db.insert("connector_credentials", { spaceId, ref, kind, secret });
    await ctx.db.patch(c._id, { authRef: ref, label, config: { ...((c.config as object) ?? {}), ...(config ?? {}) }, cursor: undefined });
    const jobId = await queueSync(ctx, (await ctx.db.get(c._id))!, true);
    await audit(ctx, spaceId, `user:${userId}`, "connector.connected", { connectorId: c._id, type, label, kind, jobId });
    return c._id;
  },
});

// ---- F34 scheduler (cron) -----------------------------------------------------------------

/** Enqueue `sync_connector` for every ready connector older than its interval (website → re-scan). */
export const scheduleSyncs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const ready = await ctx.db.query("connectors").withIndex("by_status", (q) => q.eq("status", "ready")).take(500);
    let queued = 0;
    for (const c of ready) {
      if (!isDue(c, now)) continue;
      if (c.type === "website") {
        const space = await ctx.db.get(c.spaceId);
        const running = await ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", c.spaceId)).filter((q) => q.eq(q.field("status"), "running")).first();
        if (!space || running) continue;
        const scanId = await ctx.db.insert("scans", { spaceId: c.spaceId, url: `https://${space.host}`, status: "running", progress: 0, pageCount: 0 });
        await ctx.db.patch(c._id, { status: "syncing" });
        await startScanJobs(ctx, c.spaceId, scanId);
        await audit(ctx, c.spaceId, "system:scheduler", "scan.rescheduled", { scanId, connectorId: c._id });
      } else {
        // `stale` = the upstream moved on since lastSyncedAt; the worker flips it to syncing → ready.
        await ctx.db.patch(c._id, { status: "stale" });
        const jobId = await enqueue(ctx, { spaceId: c.spaceId, connectorId: c._id }, "sync_connector", {});
        await audit(ctx, c.spaceId, "system:scheduler", "connector.sync_scheduled", { connectorId: c._id, type: c.type, jobId });
      }
      queued++;
    }
    return queued;
  },
});

// ---- worker API (WORKER_SECRET) -------------------------------------------------------------

/** The only read of a credential outside internal functions: the worker, behind WORKER_SECRET. */
export const credential = workerQuery({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, { connectorId }) => {
    const c = await ctx.db.get(connectorId);
    if (!c?.authRef) return null;
    const cred = await ctx.db.query("connector_credentials").withIndex("by_ref", (q) => q.eq("ref", c.authRef!)).first();
    return cred ? { kind: cred.kind, secret: cred.secret } : null;
  },
});

/** Known items for a connector scope, so syncs can skip refetching unchanged upstream objects. */
export const knownItems = workerQuery({
  args: { connectorId: v.id("connectors"), prefix: v.string() },
  handler: async (ctx, { connectorId, prefix }) => {
    const items = await ctx.db.query("source_items").withIndex("by_connector", (q) => q.eq("connectorId", connectorId)).collect();
    return items
      .filter((i) => i.externalId.startsWith(prefix) && !i.removedAt)
      .map((i) => ({ externalId: i.externalId, rev: ((i.meta as { rev?: string } | undefined)?.rev ?? null) as string | null }));
  },
});

/** Mark items seen in this sync without refetching (same upstream revision) — keeps them out of the sweep. */
export const touchItems = workerMutation({
  args: { connectorId: v.id("connectors"), externalIds: v.array(v.string()) },
  handler: async (ctx, { connectorId, externalIds }) => {
    const c = await ctx.db.get(connectorId);
    if (!c) return fail(404, "Connector not found");
    const now = Date.now();
    for (const externalId of externalIds) {
      const item = await ctx.db.query("source_items").withIndex("by_space_external", (q) => q.eq("spaceId", c.spaceId).eq("externalId", externalId)).first();
      if (item && item.connectorId === connectorId && !item.removedAt) await ctx.db.patch(item._id, { fetchedAt: now });
    }
  },
});

export const setSyncState = workerMutation({
  args: {
    connectorId: v.id("connectors"),
    status: connectorStatus,
    error: v.optional(v.string()),
    cursor: v.optional(v.any()),
    lastSyncedAt: v.optional(v.number()),
    label: v.optional(v.string()),
    summary: v.optional(v.any()),
  },
  handler: async (ctx, { connectorId, status, error, cursor, lastSyncedAt, label, summary }) => {
    const c = await ctx.db.get(connectorId);
    if (!c) return fail(404, "Connector not found");
    await ctx.db.patch(connectorId, {
      status,
      error: status === "error" ? error : undefined,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}),
      ...(label ? { label } : {}),
    });
    if (status === "ready" || status === "error") {
      await audit(ctx, c.spaceId, "system:sync", status === "ready" ? "connector.synced" : "connector.sync_failed", { connectorId, type: c.type, error, ...(summary ?? {}) });
    }
  },
});

export const fileUrl = workerQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId),
});

/** A pending upload was parsed + ingested (or failed): drop it from the queue. */
export const fileDone = workerMutation({
  args: { connectorId: v.id("connectors"), storageId: v.id("_storage") },
  handler: async (ctx, { connectorId, storageId }) => {
    const c = await ctx.db.get(connectorId);
    if (!c) return fail(404, "Connector not found");
    const config = (c.config as { pending?: PendingFile[] } | undefined) ?? {};
    await ctx.db.patch(connectorId, { config: { ...config, pending: (config.pending ?? []).filter((f) => f.storageId !== storageId) } });
  },
});
