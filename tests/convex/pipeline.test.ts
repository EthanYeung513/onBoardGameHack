// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  return { t, mgr, spaceId };
}

describe("pipeline jobs", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("a scan is the brand pass only; reading the site, brain and courses chain in the background", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    expect(await mgr.mutation(api.scans.start, { spaceId })).toBe(scanId); // no duplicate scan
    const order: string[] = [];
    for (;;) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w1", stages: ["crawl", "extract_design", "analyse", "seed_brain", "generate_courses", "ready"] });
      if (!c) break;
      order.push(c.job.stage);
      // Background stages still read the scan they enrich.
      expect(c.scan?._id).toBe(scanId);
      await t.mutation(api.pipeline.finish, { secret, workerId: "w1", jobId: c.job._id, outcome: { kind: "done" } });
      if (c.job.stage === "ready") expect((await mgr.query(api.pipeline.scanStatus, { scanId })).scan.status).toBe("succeeded");
    }
    // Scan jobs are claimed first, so the manager's wait is extract_design → ready.
    expect(order).toEqual(["extract_design", "ready", "crawl", "analyse", "seed_brain", "generate_courses"]);
    const status = await mgr.query(api.pipeline.scanStatus, { scanId });
    expect(status.jobs.map((j) => j.stage).sort()).toEqual(["extract_design", "ready"]);
    expect((await mgr.query(api.spaces.get, { spaceId })).status).toBe("ready");
  });

  it("a failing background stage never fails the scan", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["crawl"] });
      await t.mutation(api.pipeline.finish, { secret, workerId: "w", jobId: c!.job._id, outcome: { kind: "error", message: "site timed out" } });
      vi.advanceTimersByTime(10_000);
    }
    expect((await mgr.query(api.pipeline.scanStatus, { scanId })).scan.status).toBe("running");
  });

  it("only claims registered stages and rejects a wrong secret", async () => {
    const { t, mgr, spaceId } = await setup();
    await mgr.mutation(api.scans.start, { spaceId });
    expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["ready"] })).toBeNull();
    await expect(t.mutation(api.pipeline.claim, { secret: "nope", workerId: "w", stages: ["crawl"] })).rejects.toThrow(/401/);
  });

  it("retries with backoff, then fails the scan with a readable error after 3 attempts", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    for (let attempt = 1; attempt <= 3; attempt++) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["extract_design"] });
      expect(c, `attempt ${attempt}`).not.toBeNull();
      await t.mutation(api.pipeline.finish, { secret, workerId: "w", jobId: c!.job._id, outcome: { kind: "error", message: "site timed out" } });
      if (attempt < 3) {
        expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["extract_design"] })).toBeNull(); // backoff not elapsed
        vi.advanceTimersByTime(2000 * 2 ** (attempt - 1) + 10);
      }
    }
    const status = await mgr.query(api.pipeline.scanStatus, { scanId });
    expect(status.scan).toMatchObject({ status: "failed", error: "site timed out" });
    expect(status.jobs[0]).toMatchObject({ status: "failed", attempt: 3 });
    // Manager retry resets attempts and requeues.
    await mgr.mutation(api.pipeline.resume, { jobId: status.jobs[0].id });
    expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["extract_design"] })).not.toBeNull();
  });

  it("continue slices keep the cursor; the watchdog stalls silent jobs and a stale worker loses the job", async () => {
    const { t, mgr, spaceId } = await setup();
    await mgr.mutation(api.scans.start, { spaceId });
    let c = await t.mutation(api.pipeline.claim, { secret, workerId: "w1", stages: ["crawl"] });
    await t.mutation(api.pipeline.finish, { secret, workerId: "w1", jobId: c!.job._id, outcome: { kind: "continue", cursor: { done: ["a"] }, progress: 0.4 } });
    c = await t.mutation(api.pipeline.claim, { secret, workerId: "w1", stages: ["crawl"] });
    expect(c!.job.cursor).toEqual({ done: ["a"] });
    vi.advanceTimersByTime(61_000);
    expect(await t.mutation(internal.pipeline.watchdog, {})).toBe(1);
    expect((await t.mutation(api.pipeline.heartbeat, { secret, workerId: "w1", jobId: c!.job._id, progress: 0.5 })).lost).toBe(true);
    await mgr.mutation(api.pipeline.resume, { jobId: c!.job._id });
    const again = await t.mutation(api.pipeline.claim, { secret, workerId: "w2", stages: ["crawl"] });
    expect(again!.job.cursor).toEqual({ done: ["a"] });
    expect((await t.mutation(api.pipeline.finish, { secret, workerId: "w1", jobId: c!.job._id, outcome: { kind: "done" } })).lost).toBe(true);
  });

  it("`next` adds jobs alongside the scan chain, and the cascade is queued once per space (not per scan)", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    const all = ["crawl", "extract_design", "analyse", "seed_brain"] as const;
    for (const stage of all) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: [stage] });
      const next = stage === "seed_brain" ? [{ stage: "cascade" as const }] : undefined;
      await t.mutation(api.pipeline.finish, { secret, workerId: "w", jobId: c!.job._id, outcome: { kind: "done", next } });
    }
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.find((j) => j.stage === "generate_courses")).toMatchObject({ status: "queued", sourceScanId: scanId });
    const cascade = jobs.find((j) => j.stage === "cascade")!;
    expect(cascade.status).toBe("queued");
    expect(cascade.scanId ?? cascade.connectorId).toBeUndefined();
  });

  it("claims a scan's job before older background work (fresh scans never queue behind enrichment)", async () => {
    const { t, mgr, spaceId } = await setup();
    await t.run((ctx) => ctx.db.insert("jobs", { spaceId, stage: "seed_brain", status: "queued", progress: 0, attempt: 0, cursor: {}, runAfter: 0 }));
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["extract_design", "seed_brain"] });
    expect(c?.job).toMatchObject({ stage: "extract_design", scanId });
  });

  it("a scan-only lane never takes background work, and finds a fresh scan behind a long backlog", async () => {
    const { t, mgr, spaceId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 60; i++) await ctx.db.insert("jobs", { spaceId, stage: "seed_brain", status: "queued", progress: 0, attempt: 0, cursor: { i }, runAfter: i });
    });
    expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["seed_brain"], scanOnly: true })).toBeNull();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["extract_design", "seed_brain"], scanOnly: true });
    expect(c?.job).toMatchObject({ stage: "extract_design", scanId });
  });

  it("Generate's deploy job jumps background work, on the reserved lane too", async () => {
    const { t, spaceId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) await ctx.db.insert("jobs", { spaceId, stage: "seed_brain", status: "queued", progress: 0, attempt: 0, cursor: {}, runAfter: i });
      await ctx.db.insert("jobs", { spaceId, stage: "deploy", status: "queued", progress: 0, attempt: 0, cursor: {}, runAfter: 10 });
    });
    const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["seed_brain", "deploy"], scanOnly: true });
    expect(c?.job.stage).toBe("deploy");
  });
});
