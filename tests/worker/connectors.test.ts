import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { isDue } from "@convex/lib/connectors";
import { contentHash } from "@/worker/chunk";
import { driveQuery } from "@/worker/connectors/drive";
import { githubSyncer, isDocPath, issueDoc } from "@/worker/connectors/github";
import { ConnectorAuthError, createHttp, retryAfterMs } from "@/worker/connectors/http";
import { adfToText, jiraIssueDoc, jiraJql } from "@/worker/connectors/jira";
import { blocksToText } from "@/worker/connectors/notion";
import { channelDayDocs, windowDays } from "@/worker/connectors/slack";
import type { Syncer, SyncEnv } from "@/worker/connectors/types";
import { hashedEmbedding } from "@/worker/providers/embed";
import { runSync } from "@/worker/stages/sync_connector";
import type { StageContext } from "@/worker/types";

describe("connector mappers", () => {
  it("GitHub: picks README / CONTRIBUTING / docs markdown and maps issues vs PRs with stable ids", () => {
    expect(["README.md", "CONTRIBUTING.md", "docs/deploy.md", "docs/a/b.mdx", ".github/CONTRIBUTING.md"].every(isDocPath)).toBe(true);
    expect(["src/readme.md", "docs/logo.png", "README.md.bak", "notes.md"].some(isDocPath)).toBe(false);
    const base = { title: "Fix deploys", body: "Use the staging slot", state: "open", html_url: "https://github.com/a/b/pull/7", user: { login: "priya" }, labels: [{ name: "infra" }], updated_at: "2026-10-01T00:00:00Z" };
    const pr = issueDoc("a/b", { ...base, number: 7, pull_request: {} });
    const issue = issueDoc("a/b", { ...base, number: 8 });
    expect(pr).toMatchObject({ kind: "pr", externalId: "github:a/b:pr:7", title: "a/b#7 Fix deploys" });
    expect(pr.text).toContain("opened by @priya · labels: infra");
    expect(issue).toMatchObject({ kind: "issue", externalId: "github:a/b:issue:8" });
  });

  it("Slack: batches messages per channel-day; an edit or delete changes only that day's hash", () => {
    const ch = { id: "C1", name: "eng" };
    const msgs = [
      { ts: "1792800000.000100", user: "U1", text: "Deploys are on Tuesdays" },
      { ts: "1792800100.000100", user: "U2", text: "ack" },
      { ts: "1792886400.000100", user: "U1", text: "Next day" },
      { ts: "1792800200.000100", subtype: "channel_join", user: "U3", text: "joined" },
    ];
    const docs = channelDayDocs(ch, msgs, { U1: "Priya" });
    expect(docs.map((d) => d.externalId)).toEqual(["slack:C1:2026-10-24", "slack:C1:2026-10-25"]);
    expect(docs[0].text).toContain("Priya: Deploys are on Tuesdays");
    expect(docs[0].text).not.toContain("joined");
    const edited = channelDayDocs(ch, [{ ...msgs[0], text: "Deploys are on Thursdays" }, msgs[1], msgs[2]], { U1: "Priya" });
    expect(contentHash(edited[0].text)).not.toBe(contentHash(docs[0].text));
    expect(contentHash(edited[1].text)).toBe(contentHash(docs[1].text));
    const w = windowDays(Date.UTC(2026, 9, 25, 15), 3);
    expect(w.days).toEqual(["2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(w.oldest).toBe(Date.UTC(2026, 9, 23) / 1000); // UTC midnight: the oldest day never shrinks
  });

  it("Jira, Notion, Drive: flatten rich text and build incremental queries", () => {
    const adf = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Rollback with " }, { type: "text", text: "make undo" }] }] };
    expect(adfToText(adf).trim()).toBe("Rollback with make undo");
    expect(jiraIssueDoc({ key: "OPS-1", fields: { summary: "Rollback", description: adf, status: { name: "Done" } } })).toMatchObject({ kind: "issue", externalId: "jira:OPS-1" });
    expect(jiraJql(null)).toBe("order by updated DESC");
    expect(jiraJql("2026-10-25T09:05:00.000Z")).toBe('updated >= "2026-10-25 09:05" order by updated DESC');
    expect(blocksToText([{ type: "heading_1", heading_1: { rich_text: [{ plain_text: "Handbook" }] } }, { type: "to_do", to_do: { rich_text: [{ plain_text: "Get laptop" }], checked: true } }])).toBe("# Handbook\n\n- [x] Get laptop");
    expect(driveQuery("2026-10-25T00:00:00Z")).toContain("modifiedTime > '2026-10-25T00:00:00Z'");
    expect(driveQuery(null)).not.toContain("modifiedTime");
  });
});

describe("connector http", () => {
  const res = (status: number, headers: Record<string, string> = {}, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers });

  it("waits out Retry-After, and a 401 is a non-retryable auth error", async () => {
    expect(retryAfterMs(res(429, { "retry-after": "2" }))).toBe(2000);
    expect(retryAfterMs(res(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "110" }), 100_000)).toBe(10_000);
    expect(retryAfterMs(res(403))).toBeNull();
    const fetch = vi.fn().mockResolvedValueOnce(res(429, { "retry-after": "0" })).mockResolvedValueOnce(res(200, {}, { ok: 1 }));
    const http = createHttp({ service: "GitHub", baseUrl: "https://x", headers: {}, fetch });
    expect(await http.json("/a")).toEqual({ ok: 1 });
    const denied = createHttp({ service: "GitHub", baseUrl: "https://x", headers: {}, fetch: async () => res(401) });
    await expect(denied.json("/a")).rejects.toBeInstanceOf(ConnectorAuthError);
  });
});

describe("cron due logic", () => {
  const base = { _creationTime: 0, config: undefined, authRef: "cred_1", lastSyncedAt: 0 };
  it("enqueues ready, connected connectors past their interval only", () => {
    const now = 16 * 60_000;
    expect(isDue({ ...base, type: "github", status: "ready" }, now)).toBe(true);
    expect(isDue({ ...base, type: "github", status: "ready", lastSyncedAt: now - 60_000 }, now)).toBe(false);
    expect(isDue({ ...base, type: "github", status: "syncing" }, now)).toBe(false);
    expect(isDue({ ...base, type: "github", status: "ready", authRef: undefined }, now)).toBe(false);
    expect(isDue({ ...base, type: "files", status: "ready" }, now)).toBe(false);
    expect(isDue({ ...base, type: "website", status: "ready", authRef: undefined }, now)).toBe(false); // daily
    expect(isDue({ ...base, type: "website", status: "ready", authRef: undefined }, 25 * 3600_000)).toBe(true);
  });
});

// ---- the sync driver against an in-memory Convex ---------------------------------------------

function fakeConvex() {
  const items = new Map<string, { hash: string; version: number; fetchedAt: number; removed?: boolean }>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let clock = 0;
  const convex = {
    async query(fn: unknown) {
      const name = getFunctionName(fn as never);
      if (name === "connectors:credential") return { kind: "pat", secret: "tok" };
      if (name === "connectors:knownItems") return [];
      throw new Error(`unexpected query ${name}`);
    },
    async mutation(fn: unknown, args: Record<string, unknown>) {
      const name = getFunctionName(fn as never);
      calls.push({ fn: name, args });
      if (name === "ingest:upsertItem") {
        const id = String(args.externalId);
        const prev = items.get(id);
        clock = Date.now();
        if (!prev) {
          items.set(id, { hash: String(args.contentHash), version: 1, fetchedAt: clock });
          return { sourceItemId: id, version: 1, status: "added" };
        }
        if (prev.hash === args.contentHash && !prev.removed) {
          prev.fetchedAt = clock;
          return { sourceItemId: id, version: prev.version, status: "unchanged" };
        }
        Object.assign(prev, { hash: args.contentHash, version: prev.version + 1, fetchedAt: clock, removed: false });
        return { sourceItemId: id, version: prev.version, status: "changed" };
      }
      if (name === "ingest:addChunks") return { written: 1, superseded: false };
      if (name === "ingest:sweepRemoved") {
        let removed = 0;
        for (const [id, it] of items) if (id.startsWith(String(args.prefix)) && !it.removed && it.fetchedAt < Number(args.before)) {
          it.removed = true;
          removed++;
        }
        return { removed };
      }
      return null;
    },
  };
  return { convex, items, calls, tick: () => clock };
}

function ctxFor(convex: ReturnType<typeof fakeConvex>, cursor: Record<string, unknown>, connCursor?: unknown, budget = 60_000) {
  const progress: Record<string, unknown>[] = [];
  const ctx = {
    job: { _id: "j1", stage: "sync_connector", cursor, progress: 0 },
    space: { _id: "s1", name: "Acme" },
    scan: null,
    connector: { _id: "c1", type: "github", status: "ready", cursor: connCursor, config: {} },
    convex: convex.convex,
    llm: {},
    embed: { mode: "offline", embed: async (t: string[]) => t.map((x) => hashedEmbedding(x)) },
    remainingMs: () => budget,
    event: async () => undefined,
    progress: async (_: number, c?: Record<string, unknown>) => void (c && progress.push(structuredClone(c))),
    lost: () => false,
  } as unknown as StageContext;
  return { ctx, progress };
}

/** A two-level fake upstream: "list" → one "doc" task per page; scope `fake:` fully enumerated. */
function fakeSyncer(pages: Record<string, string>, seenSince: (string | null)[]): Syncer {
  return {
    service: "Fake",
    maxItems: 100,
    start: (env: SyncEnv) => (seenSince.push(env.since), [{ kind: "list" }]),
    async run(task) {
      if (task.kind === "list") return { tasks: Object.keys(pages).map((id) => ({ kind: "doc", id })), sweep: ["fake:"] };
      const id = String(task.id);
      return { docs: [{ kind: "doc", externalId: `fake:${id}`, title: id, text: pages[id] }] };
    },
  };
}

describe("sync_connector driver", () => {
  it("full sync → incremental since cursor → change + removal sweep, chaining seed_brain + cascade", async () => {
    const fc = fakeConvex();
    const since: (string | null)[] = [];
    const pages = { a: "Deploys on Tuesdays", b: "Oncall rota" };
    const r1 = await runSync(ctxFor(fc, {}).ctx, { syncers: { github: fakeSyncer(pages, since) } });
    expect(r1).toMatchObject({ done: true, next: [{ stage: "seed_brain" }, { stage: "cascade" }] });
    const ready = fc.calls.filter((c) => c.fn === "connectors:setSyncState" && c.args.status === "ready").at(-1)!.args;
    expect(ready.summary).toMatchObject({ added: 2, mode: "full" });
    const connCursor = ready.cursor as { since: string; lastFullAt: number };

    // Second sync, nothing upstream changed: incremental (since = first start), no chained stages.
    const r2 = await runSync(ctxFor(fc, {}, connCursor).ctx, { syncers: { github: fakeSyncer(pages, since) } });
    expect(since[1]).toBe(connCursor.since);
    expect(r2).toMatchObject({ done: true, next: undefined });

    // Manual full sync after an edit and a deletion upstream.
    await new Promise((r) => setTimeout(r, 5));
    const r3 = await runSync(ctxFor(fc, { full: true }, connCursor).ctx, { syncers: { github: fakeSyncer({ a: "Deploys on Thursdays" }, since) } });
    expect(since[2]).toBeNull();
    expect(r3.done && r3.summary).toBe("Fake: 0 new, 1 changed, 1 removed, 0 unchanged");
    expect(fc.items.get("fake:b")?.removed).toBe(true);
  });

  it("resumes a sliced sync from the job cursor without repeating finished tasks", async () => {
    const fc = fakeConvex();
    const pages = { a: "one", b: "two", c: "three" };
    const syncer = fakeSyncer(pages, []);
    let budget = 60_000;
    const orig = syncer.run.bind(syncer);
    const run = vi.spyOn(syncer, "run");
    const first = ctxFor(fc, {});
    // Out of budget after the first two tasks ("list" + "a").
    (first.ctx as { remainingMs: () => number }).remainingMs = () => budget;
    run.mockImplementation(async (t, e) => {
      const r = await orig(t, e);
      if (run.mock.calls.length >= 2) budget = 1000;
      return r;
    });
    const r1 = await runSync(first.ctx, { syncers: { github: syncer } });
    expect(r1).toMatchObject({ done: false });
    if (r1.done) return;
    expect((r1.cursor.queue as unknown[]).length).toBe(2);
    budget = 60_000;
    const r2 = await runSync(ctxFor(fc, r1.cursor).ctx, { syncers: { github: syncer } });
    expect(r2.done && r2.summary).toBe("Fake: 3 new, 0 changed, 0 removed, 0 unchanged");
    expect(run.mock.calls.map(([t]) => t.id ?? t.kind)).toEqual(["list", "a", "b", "c"]);
  });

  it("never sweeps after hitting the item cap", async () => {
    const fc = fakeConvex();
    await runSync(ctxFor(fc, {}).ctx, { syncers: { github: fakeSyncer({ a: "1", b: "2" }, []) } });
    const sweeps = () => fc.calls.filter((c) => c.fn === "ingest:sweepRemoved").length;
    const before = sweeps();
    const capped = { ...fakeSyncer({ a: "1", b: "2", c: "3" }, []), maxItems: 1 };
    const r = await runSync(ctxFor(fc, { full: true }).ctx, { syncers: { github: capped } });
    expect(r.done && r.summary).toContain("(capped)");
    expect(sweeps()).toBe(before);
    expect(fc.items.get("fake:b")?.removed).toBeFalsy();
  });

  it("GitHub syncer skips unchanged blobs by sha and sweeps the repo's doc scope", async () => {
    const json = vi.fn(async (path: string) => {
      if (path.startsWith("/user/repos")) return [{ full_name: "acme/handbook", default_branch: "main", owner: { login: "acme", type: "User" } }];
      if (path.includes("/git/trees/")) return { truncated: false, tree: [{ path: "README.md", type: "blob", sha: "s1", size: 10 }, { path: "docs/oncall.md", type: "blob", sha: "s2", size: 10 }, { path: "src/x.ts", type: "blob", sha: "s3" }] };
      throw new Error(path);
    });
    const env = { connector: { config: {} }, since: null, http: { json }, known: async () => new Map([["github:acme/handbook:doc:README.md", "s1"]]), event: async () => undefined } as unknown as SyncEnv;
    const repos = await githubSyncer.run({ kind: "repos" }, env);
    expect(repos.tasks).toEqual([{ kind: "tree", repo: "acme/handbook", branch: "main" }, { kind: "issues", repo: "acme/handbook" }]);
    const tree = await githubSyncer.run(repos.tasks![0], env);
    expect(tree.touch).toEqual(["github:acme/handbook:doc:README.md"]);
    expect(tree.tasks).toEqual([{ kind: "blob", repo: "acme/handbook", branch: "main", path: "docs/oncall.md", sha: "s2" }]);
    expect(tree.sweep).toEqual(["github:acme/handbook:doc:"]);
  });
});
