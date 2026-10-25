// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type { CourseSpec } from "@/lib/flow/course-spec";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.example" });
  const [f1, f2] = await t.run(async (ctx) =>
    Promise.all(
      ["Marco runs the on-call rotation each week.", "Escalate a red CI build to Marco after 30 minutes."].map((text) =>
        ctx.db.insert("facts", { spaceId, category: "Policy", text, confidence: 0.95, sourceChunkIds: [], status: "approved", createdBy: "agent", version: 1 }),
      ),
    ),
  );
  const spec: CourseSpec = {
    title: "Tools & Stack",
    icon: "wrench",
    building: "Workshop",
    game: "road",
    steps: [
      { id: "hi", kind: "welcome", title: "Welcome", teaches_fact_ids: [] },
      { id: "oncall", kind: "lesson", title: "On-call", body: "Marco runs on-call.\nIt rotates weekly.\nCheck the rota.\nAsk Marco.", teaches_fact_ids: [f1] },
      { id: "ci-quiz", kind: "quiz", title: "Red CI build", body: "What now?", options: [{ label: "Wait 30 min, then Marco", correct: true, why: "The rule." }, { label: "Ignore it", why: "No." }], teaches_fact_ids: [f2] },
      { id: "bye", kind: "done", title: "Done", teaches_fact_ids: [] },
    ],
  };
  const courseId = await t.run((ctx) => ctx.db.insert("courses", { spaceId, packType: "tools-stack", title: spec.title, icon: spec.icon, building: spec.building, game: spec.game, spec, status: "draft", needsRefresh: false, version: 1 }));
  return { t, mgr, spaceId, courseId, f1, f2, spec };
}

describe("course learning (Mubit learns how the manager edits courses)", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.stubEnv("MUBIT_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("offline: an assistant edit is applied, recorded as evidence and schedules the Mubit loop; the loop distils preferences", async () => {
    const { t, mgr, spaceId, courseId } = await setup();
    const r = await mgr.action(api.courseAssist.assist, { courseId, version: 1, instruction: "remove the red ci build" });
    expect(r).toMatchObject({ applied: true, mode: "offline", version: 2 });
    const [course, edits, scheduled] = await t.run(async (ctx) => [await ctx.db.get(courseId), await ctx.db.query("course_edits").collect(), await ctx.db.system.query("_scheduled_functions").collect()] as const);
    expect((course!.spec as CourseSpec).steps.map((s) => s.id)).toEqual(["hi", "oncall", "bye"]);
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ spaceId, packType: "tools-stack", accepted: true, mode: "offline", fromVersion: 1, toVersion: 2, signals: ["removed 1 quiz step"] });
    expect(edits[0].patchSummary).toBe('removed quiz "Red CI build"');
    expect(edits[0].actor).toMatch(/^user:/);
    expect(scheduled.map((s) => s.name)).toContain("courseAssist:loop");

    await t.action(internal.courseAssist.loop, { editId: edits[0]._id });
    const [edit, prefs] = await t.run(async (ctx) => [await ctx.db.get(edits[0]._id), await ctx.db.query("course_preferences").collect()] as const);
    expect(edit?.loop).toMatchObject({ feedback: { sink: "distil", delivered: false }, memory: { status: "skipped" } });
    expect(prefs[0]).toMatchObject({ mode: "offline", basedOnEdits: 1, items: [{ text: "Use fewer quizzes", evidenceEditIds: [edits[0]._id] }] });
    expect(await mgr.query(api.courseLearning.preferences, { spaceId })).toMatchObject({ items: ["Use fewer quizzes"] });
    // Nothing new since: the hourly cron has no work.
    expect(await t.action(internal.courseAssist.distilDue, {})).toEqual({ due: 0, distilled: 0 });
  });

  it("offline: an instruction it can't do is answered honestly and changes nothing", async () => {
    const { t, mgr, courseId } = await setup();
    const r = await mgr.action(api.courseAssist.assist, { courseId, version: 1, instruction: "make the quiz harder" });
    expect(r).toMatchObject({ applied: false, mode: "offline" });
    expect(r.reply).toMatch(/Mubit is not configured/);
    expect(await t.run((ctx) => ctx.db.query("course_edits").collect())).toHaveLength(0);
  });

  it("live: any instruction goes to course.assist with the course, facts and preferences; invalid patches go back to the model", async () => {
    vi.stubEnv("MUBIT_API_KEY", "k");
    const { t, mgr, courseId, f1, spaceId } = await setup();
    await t.run((ctx) => ctx.db.insert("course_preferences", { spaceId, items: [{ text: "Prefer scenario steps over quizzes", evidenceEditIds: [] }], basedOnEdits: 1, lastEditAt: 0, updatedAt: 0, mode: "live" }));
    const scenario = { id: "oncall-scenario", kind: "scenario", title: "Your on-call week", body: "Your pager goes off at 2am.", options: [{ label: "Check the rota, then ping Marco", correct: true, why: "Marco runs on-call." }, { label: "Mute it", why: "Never." }] };
    const answers = [
      { reply: "Added a scenario.", patches: [{ op: "add", path: "/steps/3", value: { ...scenario, teaches_fact_ids: ["not-a-fact"] } }] },
      { reply: "Added an on-call scenario before the end.", patches: [{ op: "add", path: "/steps/3", value: { ...scenario, teaches_fact_ids: [f1] } }] },
    ];
    const bodies: { messages: { role: string; content: string }[] }[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const content = JSON.stringify(answers[bodies.length - 1]);
      return new Response(JSON.stringify({ id: "c", model: "gpt-x", choices: [{ index: 0, message: { role: "assistant", content } }] }), { status: 200, headers: { "content-type": "application/json", "x-middleware-request-id": `mreq_${bodies.length}` } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await mgr.action(api.courseAssist.assist, { courseId, version: 1, instruction: "add a scenario about our on-call rotation" });
    expect(r).toMatchObject({ applied: true, mode: "live", requestId: "mreq_2", reply: "Added an on-call scenario before the end." });
    expect(bodies).toHaveLength(2);
    const user = JSON.parse(bodies[0].messages[1].content);
    expect(user).toMatchObject({ instruction: "add a scenario about our on-call rotation", manager_preferences: ["Prefer scenario steps over quizzes"] });
    expect(user.facts.map((f: { id: string }) => f.id)).toContain(f1);
    expect(bodies[1].messages.at(-1)!.content).toMatch(/not-a-fact/);
    const [edit] = await t.run((ctx) => ctx.db.query("course_edits").collect());
    expect(edit).toMatchObject({ mubitRequestId: "mreq_2", mode: "live", signals: ["added 1 scenario step"] });
  });

  it("only managers of the space can use the assistant; a stale version is a 409", async () => {
    const { t, mgr, courseId } = await setup();
    await expect(t.action(api.courseAssist.assist, { courseId, version: 1, instruction: "rename it to X" })).rejects.toThrow(/Sign in/);
    await expect(mgr.action(api.courseAssist.assist, { courseId, version: 7, instruction: "rename it to X" })).rejects.toThrow(/changed since you opened it/);
  });

  it("generate_courses reads the learned preferences through the worker query", async () => {
    const { t, spaceId } = await setup();
    await t.run((ctx) => ctx.db.insert("course_preferences", { spaceId, items: [{ text: "Keep lessons to 2 short lines or fewer", evidenceEditIds: [] }], basedOnEdits: 2, lastEditAt: 0, updatedAt: 0, mode: "offline" }));
    expect(await t.query(api.courseLearning.forGeneration, { secret, spaceId: spaceId as Id<"spaces"> })).toMatchObject({ company: "Acme Pay", preferences: ["Keep lessons to 2 short lines or fewer"] });
  });
});
