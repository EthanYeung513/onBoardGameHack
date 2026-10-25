// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId, slug } = await mgr.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.example" });
  return { t, mgr, spaceId, slug };
}

describe("Generate → deploy (D-33)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("refuses to publish without a course, then queues one deploy job per press", async () => {
    const { t, mgr, spaceId } = await setup();
    await expect(mgr.mutation(api.deploy.deployOnboarding, { spaceId })).rejects.toThrow(/422/);
    await t.run((ctx) => ctx.db.insert("courses", { spaceId, packType: "company", title: "Company 101", icon: "landmark", building: "HQ Hall", game: "quiz", spec: { steps: [] }, status: "draft", needsRefresh: false, version: 1 }));
    expect(await mgr.mutation(api.deploy.deployOnboarding, { spaceId })).toEqual({ queued: true });
    expect(await mgr.mutation(api.deploy.deployOnboarding, { spaceId })).toEqual({ queued: false }); // already building
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    expect(jobs.filter((j) => j.stage === "deploy")).toHaveLength(1);
    expect((await mgr.query(api.spaces.get, { spaceId })).deployState).toBe("building");
  });

  it("records the URL, and only a published space is served publicly", async () => {
    const { t, mgr, spaceId, slug } = await setup();
    expect(await t.query(api.deploy.published, { slug })).toBeNull();
    await t.mutation(api.deploy.recordDeploy, { secret, spaceId, ok: true, mode: "stand-in", url: `/o/${slug}` });
    const space = await mgr.query(api.spaces.get, { spaceId });
    expect(space).toMatchObject({ deployState: "ready", deployMode: "stand-in", deployUrl: `/o/${slug}` });
    const pub = await t.query(api.deploy.published, { slug });
    expect(pub?.input.space.name).toBe("Acme Pay");
    await expect(t.mutation(api.deploy.recordDeploy, { secret: "nope", spaceId, ok: true, mode: "vercel" })).rejects.toThrow(/401/);
  });

  it("never locks Publish: a failed, stalled or orphaned push re-enables it with the error shown", async () => {
    const { t, mgr, spaceId } = await setup();
    await t.run((ctx) => ctx.db.insert("courses", { spaceId, packType: "company", title: "Company 101", icon: "landmark", building: "HQ Hall", game: "quiz", spec: { steps: [] }, status: "draft", needsRefresh: false, version: 1 }));
    // A fresh space with courses and no deploy: enabled.
    expect(await mgr.query(api.deploy.status, { spaceId })).toEqual({ building: false, error: null });
    await mgr.mutation(api.deploy.deployOnboarding, { spaceId });
    expect((await mgr.query(api.deploy.status, { spaceId })).building).toBe(true);
    // The worker gives up for good: the space shows the error and Publish is enabled again.
    for (let attempt = 0; attempt < 3; attempt++) {
      const c = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["deploy"] });
      if (!c) break;
      await t.mutation(api.pipeline.finish, { secret, workerId: "w", jobId: c.job._id, outcome: { kind: "error", message: "Vercel said 429", maxAttempts: 1 } });
    }
    expect(await mgr.query(api.deploy.status, { spaceId })).toEqual({ building: false, error: "Vercel said 429" });
    // A "building" flag left with no job (e.g. from before this fix) doesn't block a new push.
    await t.run((ctx) => ctx.db.patch(spaceId, { deployState: "building" }));
    expect(await mgr.mutation(api.deploy.deployOnboarding, { spaceId })).toEqual({ queued: true });
  });
});
