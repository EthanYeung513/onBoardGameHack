// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

/** A published space with one course whose quiz step teaches an approved fact. */
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId, slug } = await mgr.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.example" });
  const { courseId, factId } = await t.run(async (ctx) => {
    const factId = await ctx.db.insert("facts", { spaceId, text: "Deploys happen on Tuesdays.", category: "Tools", status: "approved", confidence: 0.9, version: 1, sourceChunkIds: [], createdBy: "agent" });
    const spec = {
      title: "Tools & Stack", icon: "wrench", building: "Workshop", game: "quiz",
      steps: [
        { id: "welcome", kind: "welcome", title: "Welcome", teaches_fact_ids: [] },
        { id: "deploys", kind: "quiz", title: "When do we deploy?", options: [{ label: "Tuesdays", correct: true }, { label: "Fridays" }], teaches_fact_ids: [factId] },
        { id: "done", kind: "done", title: "Done", teaches_fact_ids: [] },
      ],
    };
    const courseId = await ctx.db.insert("courses", { spaceId, packType: "tools-stack", title: "Tools & Stack", icon: "wrench", building: "Workshop", game: "quiz", spec, status: "published", publishedSpec: spec, publishedVersion: 1, needsRefresh: false, version: 1 });
    return { courseId, factId };
  });
  await t.mutation(api.deploy.recordDeploy, { secret, spaceId, ok: true, mode: "stand-in", url: `/o/${slug}` });
  return { t, mgr, spaceId, slug, courseId, factId };
}

describe("Update courses on detected changes (D-36)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("company change → stale steps refreshed as New → manager's one click publishes them; never automatic", async () => {
    const { t, mgr, spaceId, slug, courseId } = await setup();
    expect(await mgr.query(api.deploy.pendingUpdates, { spaceId })).toMatchObject({ changed: [] });

    // Mubit's loop flagged the step stale; when the cascade finishes it queues a drift refresh.
    await t.run((ctx) => ctx.db.patch(courseId, { needsRefresh: true, staleStepIds: ["deploys"] }));
    expect(await t.mutation(api.courses.refreshAfterDrift, { secret, spaceId })).toEqual({ queued: 1 });
    const job = (await t.run((ctx) => ctx.db.query("jobs").collect())).find((j) => j.stage === "generate_courses")!;
    expect(job.cursor.targets).toEqual([{ packType: "tools-stack", stepIds: ["deploys"], requestedBy: "system:drift" }]);

    // The refresh rewrites the step: New badge, published content untouched, nothing deployed.
    await t.mutation(api.courseGen.applySteps, {
      secret, courseId, baseVersion: 1, stepIds: ["deploys"], mode: "live", jobId: job._id, requestedBy: "system:drift",
      patches: [{ op: "set", path: "/steps/1/title", value: "Which day do we deploy now?" }],
    });
    const course = await t.run((ctx) => ctx.db.get(courseId));
    expect(course).toMatchObject({ version: 2, newStepIds: ["deploys"], staleStepIds: [], needsRefresh: false, publishedVersion: 1 });
    const pending = await mgr.query(api.deploy.pendingUpdates, { spaceId });
    expect(pending?.changed).toEqual([{ courseId, title: "Tools & Stack", newSteps: 1, isNew: false }]);
    // The hire's world still serves what was pushed.
    const before = await t.query(api.deploy.published, { slug });
    expect(before?.input.courses[0].spec.steps[1].title).toBe("When do we deploy?");
    expect((await t.run((ctx) => ctx.db.query("jobs").collect())).some((j) => j.stage === "deploy")).toBe(false);

    // "Update courses" = the existing push to the same deployment.
    expect(await mgr.mutation(api.deploy.deployOnboarding, { spaceId })).toEqual({ queued: true });
    await t.mutation(api.deploy.recordDeploy, { secret, spaceId, ok: true, mode: "stand-in", url: `/o/${slug}` });
    const after = await t.query(api.deploy.published, { slug });
    expect(after?.input.courses[0].spec.steps[1].title).toBe("Which day do we deploy now?");
    expect(await mgr.query(api.deploy.pendingUpdates, { spaceId })).toMatchObject({ changed: [] });
    expect((await t.run((ctx) => ctx.db.get(courseId)))?.newStepIds).toEqual([]);
    expect((await mgr.query(api.spaces.get, { spaceId })).deployUrl).toBe(`/o/${slug}`); // same link
  });

  it("a manager's own step refresh doesn't get a New badge", async () => {
    const { t, spaceId, courseId } = await setup();
    const job = await t.run((ctx) => ctx.db.insert("jobs", { spaceId, stage: "generate_courses", status: "running", progress: 0, attempt: 0, cursor: {} }));
    await t.mutation(api.courseGen.applySteps, {
      secret, courseId, baseVersion: 1, stepIds: ["deploys"], mode: "live", jobId: job, requestedBy: "user:x",
      patches: [{ op: "set", path: "/steps/1/title", value: "Deploy day?" }],
    });
    expect((await t.run((ctx) => ctx.db.get(courseId)))).toMatchObject({ newStepIds: [], publishedVersion: 2 });
  });
});
