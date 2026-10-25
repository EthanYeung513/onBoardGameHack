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

  it("starts a scan, chains stages in order and marks the space ready at the end", async () => {
    const { t, mgr, spaceId } = await setup();
    const scanId = await mgr.mutation(api.scans.start, { spaceId });
    expect(await mgr.mutation(api.scans.start, { spaceId })).toBe(scanId); // no duplicate scan
    const order: string[] = [];
    for (;;) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w1", stages: ["crawl", "extract_design", "analyse", "seed_brain", "generate_courses", "ready"] });
      if (!c) break;
      order.push(c.job.stage);
      await t.mutation(api.pipeline.finish, { secret, workerId: "w1", jobId: c.job._id, outcome: { kind: "done" } });
    }
    expect(order).toEqual(["crawl", "extract_design", "analyse", "seed_brain", "generate_courses", "ready"]);
    const status = await mgr.query(api.pipeline.scanStatus, { scanId });
    expect(status.scan.status).toBe("succeeded");
    expect(status.events.map((e) => e.message)).toContain("Reading your website finished");
    expect((await mgr.query(api.spaces.get, { spaceId })).status).toBe("ready");
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
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["crawl"] });
      expect(c, `attempt ${attempt}`).not.toBeNull();
      await t.mutation(api.pipeline.finish, { secret, workerId: "w", jobId: c!.job._id, outcome: { kind: "error", message: "site timed out" } });
      if (attempt < 3) {
        expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["crawl"] })).toBeNull(); // backoff not elapsed
        vi.advanceTimersByTime(2000 * 2 ** (attempt - 1) + 10);
      }
    }
    const status = await mgr.query(api.pipeline.scanStatus, { scanId });
    expect(status.scan).toMatchObject({ status: "failed", error: "site timed out" });
    expect(status.jobs[0]).toMatchObject({ status: "failed", attempt: 3 });
    // Manager retry resets attempts and requeues.
    await mgr.mutation(api.pipeline.resume, { jobId: status.jobs[0].id });
    expect(await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["crawl"] })).not.toBeNull();
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
    expect(jobs.find((j) => j.stage === "generate_courses")).toMatchObject({ status: "queued", scanId });
    const cascade = jobs.find((j) => j.stage === "cascade")!;
    expect(cascade.status).toBe("queued");
    expect(cascade.scanId ?? cascade.connectorId).toBeUndefined();
  });
});
