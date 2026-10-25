// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type { CourseSpec } from "@/lib/flow/course-spec";
import { createEmbedder } from "@/worker/providers/embed";
import { createLlm, type Llm } from "@/worker/providers/llm";
import { runSlice } from "@/worker/runner";
import { generateCoursesStage } from "@/worker/stages/generate-courses";
import type { WorkerConvex } from "@/worker/types";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;

async function setup() {
  const t = makeT();
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.example" });
  const connectorId = await t.mutation(api.ingest.ensureConnector, { secret, spaceId, type: "slack" });
  return { t, mgr, spaceId, connectorId };
}

type FactIn = { text: string; category: "Tools" | "People" | "Policy" | "Glossary"; status?: "approved" | "draft"; source?: string };

/** Facts with real provenance: each cites a chunk of an ingested source item. */
async function addFacts(t: T, spaceId: Id<"spaces">, connectorId: Id<"connectors">, facts: FactIn[]) {
  const ids: Id<"facts">[] = [];
  for (const [i, f] of facts.entries()) {
    const externalId = f.source ?? `msg-${i}`;
    const { sourceItemId, version } = await t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "message", externalId, title: externalId, contentHash: `h-${externalId}` });
    ids.push(
      await t.run(async (ctx) => {
        const chunkId = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId, version, idx: i, text: f.text, tokens: 10 });
        const factId = await ctx.db.insert("facts", { spaceId, category: f.category, text: f.text, confidence: 0.95, sourceChunkIds: [chunkId], status: f.status ?? "approved", createdBy: "agent", version: 1 });
        await ctx.db.insert("fact_citations", { spaceId, factId, chunkId, sourceItemId });
        return factId;
      }),
    );
  }
  return ids;
}

const FACTS: FactIn[] = [
  { category: "Tools", text: "Staging deploys happen automatically on merge to main.", source: "deploys" },
  { category: "Tools", text: "The FALCON board in Jira belongs to the Payments team." },
  { category: "Tools", text: "Secrets live in The Vault, never in Slack.", status: "draft" },
  { category: "People", text: "Marco owns the deploy pipeline." },
  { category: "People", text: "Priya reviews all architecture PRs." },
  { category: "Policy", text: "Escalate a red CI build to Marco after 30 minutes." },
];

function workerConvex(t: T): WorkerConvex {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: ((fn: any, args: object) => t.query(fn, { ...args, secret })) as never,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutation: ((fn: any, args: object) => t.mutation(fn, { ...args, secret })) as never,
  };
}

/** Claim the next generate_courses job and run one slice through the real runner. */
async function runCourseJob(t: T, llm: Llm) {
  const claimed = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["generate_courses"] });
  expect(claimed).not.toBeNull();
  const outcome = await runSlice(claimed!, { convex: workerConvex(t), llm, embed: createEmbedder(), workerId: "w", registry: { generate_courses: generateCoursesStage }, heartbeatMs: 60_000 });
  const events = await t.run((ctx) => ctx.db.query("job_events").withIndex("by_job", (q) => q.eq("jobId", claimed!.job._id)).collect());
  return { outcome, events: events.map((e) => e.message) };
}

const queueScanJob = (t: T, spaceId: Id<"spaces">) =>
  t.run((ctx) => ctx.db.insert("jobs", { spaceId, stage: "generate_courses", status: "queued", progress: 0, attempt: 0, cursor: {}, runAfter: 0 }));

const offlineLlm = () => createLlm();
const courses = (t: T) => t.run((ctx) => ctx.db.query("courses").collect());

describe("generate_courses stage", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.stubEnv("MUBIT_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("offline: drafts the mockup's courses from approved facts only and skips packs with too few", async () => {
    const { t, spaceId, connectorId } = await setup();
    const [deploy, falcon, vault] = await addFacts(t, spaceId, connectorId, FACTS);
    await queueScanJob(t, spaceId);
    const { outcome, events } = await runCourseJob(t, offlineLlm());
    expect(outcome).toBe("done");

    const rows = await courses(t);
    expect(rows.map((c) => [c.packType, c.title, c.building, c.icon, c.game]).sort()).toEqual([
      ["hard-conversations", "Hard Conversations", "Dojo", "target", "scenario"],
      ["people-culture", "People & Culture", "Community Hall", "users", "inbox"],
      ["tools-stack", "Tools & Stack", "Workshop", "wrench", "road"],
    ]);
    expect(events.join("\n")).toMatch(/Skipped Company 101: 0 approved .* needs 2/);
    expect(events.join("\n")).toMatch(/Drafted Tools & Stack: \d+ steps teaching 2 facts \(offline stand-in\)/);

    const tools = rows.find((c) => c.packType === "tools-stack")!;
    expect(tools).toMatchObject({ status: "draft", mode: "offline", version: 1, needsRefresh: false });
    const spec = tools.spec as CourseSpec;
    expect(spec.steps[0].kind).toBe("welcome");
    expect(spec.steps.at(-1)!.kind).toBe("done");
    const cited = spec.steps.flatMap((s) => s.teaches_fact_ids);
    expect(new Set(cited)).toEqual(new Set([deploy, falcon]));
    expect(cited).not.toContain(vault); // draft facts are never taught
    const links = await t.run((ctx) => ctx.db.query("course_facts").withIndex("by_course", (q) => q.eq("courseId", tools._id)).collect());
    expect(links.every((l) => spec.steps.some((s) => s.id === l.stepId && s.teaches_fact_ids.includes(l.factId)))).toBe(true);

    // A re-scan keeps existing courses — they only regenerate on the manager's confirm.
    await queueScanJob(t, spaceId);
    expect((await runCourseJob(t, offlineLlm())).events.join("\n")).toMatch(/Kept Tools & Stack as it is/);
    expect((await courses(t)).find((c) => c.packType === "tools-stack")!.version).toBe(1);
  });

  it("live: sends invalid model output back with the error, then saves the corrected course", async () => {
    vi.stubEnv("MUBIT_API_KEY", "k");
    const { t, spaceId, connectorId } = await setup();
    const [deploy, falcon, vault] = await addFacts(t, spaceId, connectorId, FACTS.slice(0, 3));
    const course = (ids: string[]): CourseSpec => ({
      title: "x",
      icon: "wrench",
      building: "x",
      game: "road",
      steps: [
        { id: "hi", kind: "welcome", title: "Hi", teaches_fact_ids: [] },
        { id: "ship", kind: "lesson", title: "Ship to prod", body: "Merges go to staging.", teaches_fact_ids: ids },
        { id: "bye", kind: "done", title: "Done", teaches_fact_ids: [] },
      ],
    });
    const reply = (s: CourseSpec) => ({
      withResponse: async () => ({ data: { model: "gpt-x", choices: [{ message: { content: JSON.stringify(s) } }] }, response: new Response(null) }),
    });
    const create = vi.fn().mockReturnValueOnce(reply(course([deploy, vault]))).mockReturnValueOnce(reply(course([deploy, falcon])));
    await t.run((ctx) => ctx.db.insert("jobs", { spaceId, stage: "generate_courses", status: "queued", progress: 0, attempt: 0, cursor: { targets: [{ packType: "tools-stack" }] }, runAfter: 0 }));
    expect((await runCourseJob(t, createLlm({ chat: { completions: { create } } } as never))).outcome).toBe("done");

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][1].headers).toMatchObject({ "X-Mubit-Task": "generate_course" });
    expect(create.mock.calls[1][0].messages.at(-1).content).toContain(`"${vault}" is not an approved fact`);
    const [row] = await courses(t);
    expect(row).toMatchObject({ title: "Tools & Stack", building: "Workshop", mode: "live" }); // pack identity is the mockup's
    expect((row.spec as CourseSpec).steps[1].teaches_fact_ids).toEqual([deploy, falcon]);
  });
});

describe("course regeneration (F36)", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.stubEnv("MUBIT_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function withCourses() {
    const s = await setup();
    const factIds = await addFacts(s.t, s.spaceId, s.connectorId, FACTS);
    await queueScanJob(s.t, s.spaceId);
    await runCourseJob(s.t, offlineLlm());
    const tools = (await courses(s.t)).find((c) => c.packType === "tools-stack")!;
    return { ...s, factIds, tools };
  }

  it("a changed source marks the teaching step stale; regenerateSteps refreshes only that step and clears needsRefresh", async () => {
    const { t, mgr, spaceId, connectorId, tools, factIds } = await withCourses();
    const deployStep = (tools.spec as CourseSpec).steps.find((s) => s.teaches_fact_ids.includes(factIds[0]))!;
    await t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "message", externalId: "deploys", title: "deploys", contentHash: "edited" });

    let course = await mgr.query(api.courses.get, { courseId: tools._id });
    expect(course).toMatchObject({ needsRefresh: true, staleStepIds: [deployStep.id] });
    const audits = await t.run((ctx) => ctx.db.query("audit_events").collect());
    expect(audits.find((a) => a.kind === "course.step_stale")?.payload).toMatchObject({ courseTitle: "Tools & Stack", source: { title: "deploys", connectorType: "slack" }, stepId: deployStep.id });

    await expect(mgr.mutation(api.courses.regenerateSteps, { courseId: tools._id, stepIds: ["nope"] })).rejects.toThrow(/422/);
    await mgr.mutation(api.courses.regenerateSteps, { courseId: tools._id, stepIds: [deployStep.id] });
    expect((await mgr.query(api.courses.list, { spaceId })).find((c) => c.id === tools._id)?.regenerating).toBe(true);
    const { outcome, events } = await runCourseJob(t, offlineLlm());
    expect(outcome).toBe("done");
    expect(events.join("\n")).toMatch(/Refreshed 1 step of Tools & Stack \(offline stand-in\)/);

    course = await mgr.query(api.courses.get, { courseId: tools._id });
    expect(course).toMatchObject({ needsRefresh: false, staleStepIds: [], version: 2, regenerating: false });
    const step = course.spec.steps.find((s: { id: string }) => s.id === deployStep.id);
    expect(step.teaches_fact_ids).not.toContain(factIds[0]); // the stale fact is no longer taught
    expect(course.spec.steps.map((s: { id: string }) => s.id)).toContain("welcome");
    const kinds = (await t.run((ctx) => ctx.db.query("audit_events").collect())).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["course.regenerate_requested", "course.steps_regenerated"]));
  });

  it("regenerate rebuilds the whole course, bumps the version and republishes a published course", async () => {
    const { t, mgr, tools } = await withCourses();
    await t.run((ctx) => ctx.db.patch(tools._id, { status: "published", publishedVersion: 1, publishedSpec: tools.spec, needsRefresh: true, staleStepIds: ["x"] }));
    const { jobId } = await mgr.mutation(api.courses.regenerate, { courseId: tools._id });
    expect((await mgr.mutation(api.courses.regenerate, { courseId: tools._id })).jobId).toBe(jobId); // merged, not duplicated
    await runCourseJob(t, offlineLlm());
    const after = await t.run((ctx) => ctx.db.get(tools._id));
    expect(after).toMatchObject({ status: "published", version: 2, publishedVersion: 2, needsRefresh: false, staleStepIds: [] });
    const kinds = (await t.run((ctx) => ctx.db.query("audit_events").collect())).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["course.regenerated", "course.republished"]));
  });

  it("applyPatch: 409 on a stale version, 422 on an invalid result, 403 for non-members", async () => {
    const { t, mgr, tools, factIds } = await withCourses();
    const lesson = (tools.spec as CourseSpec).steps.findIndex((s) => s.kind === "lesson");
    expect(await mgr.mutation(api.courses.applyPatch, { courseId: tools._id, version: 1, patches: [{ op: "set", path: `/steps/${lesson}/title`, value: "Ship it" }] })).toEqual({ version: 2 });
    await expect(mgr.mutation(api.courses.applyPatch, { courseId: tools._id, version: 1, patches: [{ op: "set", path: "/title", value: "x" }] })).rejects.toThrow(/409/);
    await expect(
      mgr.mutation(api.courses.applyPatch, { courseId: tools._id, version: 2, patches: [{ op: "set", path: `/steps/${lesson}/teaches_fact_ids`, value: [factIds[2]] }] }),
    ).rejects.toThrow(/422.*not an approved fact/);
    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "eve@evil.com" }));
    await expect(t.withIdentity({ subject: `${otherId}|s` }).query(api.courses.get, { courseId: tools._id })).rejects.toThrow(/403/);
  });

  it("join page (public): course titles for anyone, no facts or specs; unknown slug → null", async () => {
    const { t, spaceId } = await withCourses();
    const space = await t.run((ctx) => ctx.db.get(spaceId));
    const page = await t.query(api.join.bySlug, { slug: space!.slug });
    expect(page?.name).toBe("Acme Pay");
    expect(page?.courses.map((c) => c.title)).toEqual(["People & Culture", "Tools & Stack", "Hard Conversations"]);
    expect(page?.courses.every((c) => !c.live && !("spec" in c))).toBe(true);
    expect(await t.query(api.join.bySlug, { slug: "nope" })).toBeNull();
  });
});
