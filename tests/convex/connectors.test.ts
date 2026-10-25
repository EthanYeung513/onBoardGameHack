// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";
import { hashedEmbedding } from "@/worker/providers/embed";
import { runSlice } from "@/worker/runner";
import { syncConnectorStage } from "@/worker/stages/sync_connector";
import type { WorkerConvex } from "@/worker/types";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";
const SLACK_SECRET = JSON.stringify({ provider: "nango", connectionId: "conn-1", providerConfigKey: "slack" });

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  const hireId = await t.run((ctx) => ctx.db.insert("users", { email: "hire@acme.com" }));
  await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: hireId, role: "hire" }));
  const hire = t.withIdentity({ subject: `${hireId}|s` });
  return { t, mgr, hire, spaceId, userId };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

const worker = (t: T): WorkerConvex => {
  const q = t.query as (fn: unknown, args: unknown) => Promise<never>;
  const m = t.mutation as (fn: unknown, args: unknown) => Promise<never>;
  return { query: (fn, args) => q(fn, { ...args, secret }), mutation: (fn, args) => m(fn, { ...args, secret }) };
};

/** Claim + run the next sync_connector slice exactly as the worker does. */
async function runWorker(t: T) {
  const claimed = await t.mutation(api.pipeline.claim, { secret, workerId: "w1", stages: ["sync_connector"] });
  if (!claimed) throw new Error("no sync_connector job queued");
  const embed = { mode: "offline" as const, embed: async (texts: string[]) => texts.map((x) => hashedEmbedding(x)) };
  return await runSlice(claimed, { convex: worker(t), llm: {} as never, embed, workerId: "w1", registry: { sync_connector: syncConnectorStage } });
}

/** Slack Web API via the Nango proxy, fixture-backed; `messages` is what #eng says right now. */
function slackFixture(messages: () => { ts: string; user: string; text: string }[]) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    expect(headers["Connection-Id"]).toBe("conn-1");
    const path = new URL(url).pathname.replace(/^\/proxy/, "");
    const body =
      path === "/conversations.list"
        ? { ok: true, channels: [{ id: "C1", name: "eng", is_member: true, purpose: { value: "Engineering" } }] }
        : path === "/users.list"
          ? { ok: true, members: [{ id: "U1", real_name: "Priya" }] }
          : path === "/conversations.history"
            ? { ok: true, messages: messages() }
            : { ok: false, error: "unknown_method" };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("connectors (S6/S7/S15)", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.stubEnv("NANGO_SECRET_KEY", "nango-test");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("credentials stay write-only: never in public queries, worker reads need the secret", async () => {
    const { t, mgr, spaceId, userId } = await setup();
    const connectorId = await t.mutation(internal.connectors.saveCredential, { spaceId, userId, type: "github", kind: "pat", secret: "ghp_SUPERSECRET", label: "acme" });
    const listed = await mgr.query(api.connectors.list, { spaceId });
    expect(JSON.stringify(listed)).not.toMatch(/SUPERSECRET|cred_/);
    expect(listed.connectors[0]).toMatchObject({ type: "github", status: "syncing", connected: true, label: "acme" });
    await expect(t.query(api.connectors.credential, { secret: "wrong", connectorId })).rejects.toThrow(/worker secret/i);
    expect(await t.query(api.connectors.credential, { secret, connectorId })).toEqual({ kind: "pat", secret: "ghp_SUPERSECRET" });
    const audits = await t.run((ctx) => ctx.db.query("audit_events").collect());
    expect(JSON.stringify(audits)).not.toContain("SUPERSECRET");
  });

  it("Sync now and Disconnect are manager-only and audited; disconnect drops the credential, keeps items", async () => {
    const { t, mgr, hire, spaceId, userId } = await setup();
    const connectorId = await t.mutation(internal.connectors.saveCredential, { spaceId, userId, type: "github", kind: "pat", secret: "ghp_x", label: "acme" });
    await expect(hire.mutation(api.connectors.syncNow, { connectorId })).rejects.toThrow(/access/);
    await t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "doc", externalId: "github:a/b:doc:README.md", title: "README", contentHash: "h" });
    await mgr.mutation(api.connectors.disconnect, { connectorId });
    const [c, creds, items, audits] = await t.run(async (ctx) => [
      await ctx.db.get(connectorId),
      await ctx.db.query("connector_credentials").collect(),
      await ctx.db.query("source_items").collect(),
      (await ctx.db.query("audit_events").collect()).map((a) => a.kind),
    ] as const);
    expect(c?.status).toBe("pending");
    expect(c?.authRef).toBeUndefined();
    expect(creds).toHaveLength(0);
    expect(items).toHaveLength(1);
    expect(audits).toEqual(expect.arrayContaining(["connector.connected", "connector.disconnected"]));
    await expect(mgr.mutation(api.connectors.syncNow, { connectorId })).rejects.toThrow(/Connect this tool first/);
  });

  it("the scheduler enqueues due ready connectors once and marks them stale", async () => {
    const { t, spaceId } = await setup();
    const old = Date.now() - 20 * 60_000;
    const [due, fresh, files] = await t.run(async (ctx) => [
      await ctx.db.insert("connectors", { spaceId, type: "github", status: "ready", authRef: "cred_a", lastSyncedAt: old }),
      await ctx.db.insert("connectors", { spaceId, type: "slack", status: "ready", authRef: "cred_b", lastSyncedAt: Date.now() }),
      await ctx.db.insert("connectors", { spaceId, type: "files", status: "ready", lastSyncedAt: old }),
    ]);
    expect(await t.mutation(internal.connectors.scheduleSyncs, {})).toBe(1);
    expect(await t.mutation(internal.connectors.scheduleSyncs, {})).toBe(0); // stale now, not re-queued
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.map((j) => [j.stage, j.connectorId])).toEqual([["sync_connector", due]]);
    const rows = await t.run(async (ctx) => [await ctx.db.get(due), await ctx.db.get(fresh), await ctx.db.get(files)]);
    expect(rows.map((r) => r?.status)).toEqual(["stale", "ready", "ready"]);
  });

  it("rejects uploads over 5 MB or of the wrong type", async () => {
    const { t, mgr, spaceId } = await setup();
    const big = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])));
    const exe = await t.run((ctx) => ctx.storage.store(new Blob(["MZ"])));
    const ok = await t.run((ctx) => ctx.storage.store(new Blob(["# Handbook"])));
    const r = await mgr.mutation(api.connectors.addFiles, { spaceId, files: [{ storageId: big, name: "deck.pdf" }, { storageId: exe, name: "tool.exe" }, { storageId: ok, name: "handbook.md" }] });
    expect(r).toEqual({ accepted: 1, rejected: [{ name: "deck.pdf", reason: "larger than 5 MB" }, { name: "tool.exe", reason: "not a PDF, Markdown, DOCX or text file" }] });
    const c = (await mgr.query(api.connectors.list, { spaceId })).connectors[0];
    expect(c).toMatchObject({ type: "files", status: "syncing", pendingFiles: 1 });
  });

  it("uploads can be added again after the first batch is read, and both show in the list", async () => {
    const { t, mgr, hire, spaceId } = await setup();
    expect(await mgr.query(api.connectors.uploads, { spaceId })).toEqual({ pending: [], read: [] });
    const first = await t.run((ctx) => ctx.storage.store(new Blob(["# Handbook\n\nWe deploy on Tuesdays."])));
    await mgr.mutation(api.connectors.addFiles, { spaceId, files: [{ storageId: first, name: "handbook.md" }] });
    expect((await mgr.query(api.connectors.uploads, { spaceId })).pending).toEqual([{ name: "handbook.md", size: expect.any(Number) }]);
    vi.stubGlobal("fetch", async () => new Response("# Handbook\n\nWe deploy on Tuesdays."));
    expect(await runWorker(t)).toBe("done");
    expect((await mgr.query(api.connectors.list, { spaceId })).connectors[0]).toMatchObject({ type: "files", status: "ready" });

    const second = await t.run((ctx) => ctx.storage.store(new Blob(["# Glossary"])));
    expect(await mgr.mutation(api.connectors.addFiles, { spaceId, files: [{ storageId: second, name: "glossary.md" }] })).toMatchObject({ accepted: 1 });
    const list = await mgr.query(api.connectors.uploads, { spaceId });
    expect(list.pending.map((f) => f.name)).toEqual(["glossary.md"]);
    expect(list.read.map((f) => f.name)).toEqual(["handbook.md"]);
    await expect(hire.query(api.connectors.uploads, { spaceId })).rejects.toThrow();
  });

  it("a Slack message batch flows source → fact → course step: an edit marks the teaching step stale", async () => {
    const { t, spaceId, userId } = await setup();
    const now = Date.now();
    const ts = (agoMin: number) => `${Math.floor((now - agoMin * 60_000) / 1000)}.000100`;
    let rule = "Deploys happen on Tuesdays after standup";
    vi.stubGlobal("fetch", slackFixture(() => [{ ts: ts(30), user: "U1", text: rule }, { ts: ts(20), user: "U1", text: "ping me for access" }]));

    const connectorId = await t.mutation(internal.connectors.saveCredential, { spaceId, userId, type: "slack", kind: "oauth", secret: SLACK_SECRET, label: "slack" });
    expect(await runWorker(t)).toBe("done");
    const day = new Date(Number(ts(30).split(".")[0]) * 1000).toISOString().slice(0, 10);
    const item = await t.run((ctx) => ctx.db.query("source_items").withIndex("by_space_external", (q) => q.eq("spaceId", spaceId).eq("externalId", `slack:C1:${day}`)).first());
    expect(item).toMatchObject({ kind: "message", title: `#eng · ${day}`, connectorId });
    const conn = await t.run((ctx) => ctx.db.get(connectorId));
    expect(conn).toMatchObject({ status: "ready", lastSyncedAt: expect.any(Number) });
    const chained = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(chained.filter((j) => j.status === "queued").map((j) => j.stage)).toEqual(["seed_brain", "cascade"]);

    // The brain learned a fact from that day's batch, and step "s2" of a course teaches it.
    const { factId, courseId } = await t.run(async (ctx) => {
      const chunk = (await ctx.db.query("doc_chunks").withIndex("by_source", (q) => q.eq("sourceItemId", item!._id)).first())!;
      const factId = await ctx.db.insert("facts", { spaceId, category: "Rituals", text: "Deploys happen on Tuesdays", confidence: 0.95, sourceChunkIds: [chunk._id], status: "approved", createdBy: "agent", version: 1 });
      await ctx.db.insert("fact_citations", { spaceId, factId, chunkId: chunk._id, sourceItemId: item!._id });
      const courseId = await ctx.db.insert("courses", { spaceId, packType: "tools", title: "Tools & Stack", icon: "wrench", building: "Workshop", game: "road", spec: {}, status: "published", needsRefresh: false, version: 1 });
      await ctx.db.insert("course_facts", { spaceId, courseId, factId, stepId: "s2" });
      return { factId, courseId };
    });

    // Someone edits the message in Slack; the next sync sees the day's batch changed.
    rule = "Deploys moved to Thursdays";
    await t.run(async (ctx) => {
      for (const j of await ctx.db.query("jobs").collect()) if (j.status === "queued") await ctx.db.delete(j._id);
    });
    await t.withIdentity({ subject: `${userId}|s` }).mutation(api.connectors.syncNow, { connectorId });
    expect(await runWorker(t)).toBe("done");

    const [fact, course, diffs, audits] = await t.run(async (ctx) => [
      await ctx.db.get(factId),
      await ctx.db.get(courseId),
      (await ctx.db.query("diff_events").collect()).filter((d) => d.sourceItemId === item!._id).map((d) => d.kind),
      (await ctx.db.query("audit_events").collect()).filter((a) => a.kind === "fact.stale" || a.kind === "course.step_stale"),
    ] as const);
    expect(diffs).toEqual(["added", "changed"]);
    expect(fact?.status).toBe("stale");
    expect(course).toMatchObject({ needsRefresh: true, staleStepIds: ["s2"] });
    const byKind = Object.fromEntries(audits.map((a) => [a.kind, a.payload as Record<string, unknown>]));
    expect(byKind["fact.stale"]).toMatchObject({ source: { connectorType: "slack", title: `#eng · ${day}` }, factText: "Deploys happen on Tuesdays" });
    expect(byKind["course.step_stale"]).toMatchObject({ courseTitle: "Tools & Stack", stepId: "s2", source: { connectorType: "slack" } });
    expect(byKind["course.step_stale"].chain).toBe(`slack “#eng · ${day}” → fact “Deploys happen on Tuesdays” → course “Tools & Stack” → step s2`);
  });

  it("a revoked credential fails the sync once and leaves a readable error on the card", async () => {
    const { t, mgr, spaceId, userId } = await setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await t.mutation(internal.connectors.saveCredential, { spaceId, userId, type: "slack", kind: "oauth", secret: SLACK_SECRET, label: "slack" });
    expect(await runWorker(t)).toBe("error");
    const c = (await mgr.query(api.connectors.list, { spaceId })).connectors[0];
    expect(c).toMatchObject({ status: "error", error: expect.stringMatching(/rejected the stored credential.*Reconnect/) });
  });
});

