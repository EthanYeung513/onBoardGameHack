import { describe, expect, it } from "vitest";
import { applyCoursePatches, stepRefreshPatches } from "@/lib/flow/course-patch";
import { courseSpecSchema, validateCourseSpec, type CourseSpec } from "@/lib/flow/course-spec";
import { COURSE_STEPS_SYSTEM_PROMPT, COURSE_SYSTEM_PROMPT } from "@/lib/prompts";
import { normaliseRefresh } from "@/worker/stages/generate-courses";

const approved = new Set(["f1", "f2", "f3"]);

function spec(): CourseSpec {
  return {
    title: "Tools & Stack",
    icon: "wrench",
    building: "Workshop",
    game: "road",
    desc: "The stack you'll live in: repos, boards, deploys.",
    steps: [
      { id: "welcome", kind: "welcome", title: "Welcome", teaches_fact_ids: [] },
      { id: "deploys", kind: "lesson", title: "Ship to prod", body: "Staging deploys on merge.", teaches_fact_ids: ["f1"] },
      {
        id: "deploys-quiz",
        kind: "quiz",
        title: "Main branch merges deploy to…",
        options: [
          { label: "Staging", correct: true, why: "Prod needs a manual approve." },
          { label: "Production", correct: false },
        ],
        teaches_fact_ids: ["f1", "f2"],
      },
      { id: "done", kind: "done", title: "You're all set.", teaches_fact_ids: [] },
    ],
  };
}

const errorsOf = (s: unknown, ids = approved) => {
  const r = validateCourseSpec(s, ids);
  return r.ok ? [] : r.errors;
};

describe("CourseSpec validation", () => {
  it("accepts a well-formed course, treating empty options/body as absent", () => {
    expect(errorsOf(spec())).toEqual([]);
    const loose = { ...spec(), steps: spec().steps.map((st) => (st.kind === "lesson" ? { ...st, options: [], body: "" } : st)) };
    const r = validateCourseSpec(loose, approved);
    expect(r.ok && r.spec.steps[1]).toEqual({ id: "deploys", kind: "lesson", title: "Ship to prod", teaches_fact_ids: ["f1"] });
  });

  it("rejects citations of facts that are not approved in the space", () => {
    const s = spec();
    s.steps[1].teaches_fact_ids = ["f9"];
    expect(errorsOf(s)).toEqual([expect.stringContaining('"f9" is not an approved fact')]);
    s.steps[1].teaches_fact_ids = [];
    expect(errorsOf(s)).toEqual([expect.stringContaining("must cite at least one approved fact")]);
  });

  it("enforces welcome first, done last, unique step ids and fixed kinds", () => {
    const s = spec();
    [s.steps[0], s.steps[1]] = [s.steps[1], s.steps[0]];
    expect(errorsOf(s).join("\n")).toMatch(/first step must be a welcome[\s\S]*only the first step may be a welcome/);
    const d = spec();
    d.steps[2].id = "deploys";
    expect(errorsOf(d)).toEqual([expect.stringContaining('duplicate step id "deploys"')]);
    const k = spec() as unknown as { steps: { kind: string }[] };
    k.steps[1].kind = "video";
    expect(errorsOf(k)[0]).toMatch(/^steps\.1\.kind/);
  });

  it("checks option shapes per step kind", () => {
    const two = spec();
    two.steps[2].options![1].correct = true;
    expect(errorsOf(two)).toEqual([expect.stringContaining("exactly one option must be correct, got 2")]);
    const lesson = spec();
    lesson.steps[1].options = [{ label: "x" }];
    expect(errorsOf(lesson)).toEqual([expect.stringContaining("a lesson step has no options")]);
    const checklist = spec();
    checklist.steps.splice(3, 0, { id: "todo", kind: "checklist", title: "Before you go", options: [{ label: "a", correct: true }, { label: "b" }], teaches_fact_ids: [] });
    expect(errorsOf(checklist)).toEqual([expect.stringContaining("checklist options take a label only")]);
  });

  it("feeds cross-field errors through the Zod schema the LLM retry loop uses", () => {
    const s = spec();
    s.steps[1].teaches_fact_ids = ["invented"];
    const r = courseSpecSchema(approved).safeParse(s);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toMatch(/"invented" is not an approved fact/);
  });
});

describe("course patches", () => {
  it("applies set/add/remove on JSON-pointer paths and validates the result", () => {
    const r = applyCoursePatches(
      spec(),
      [
        { op: "set", path: "/steps/1/title", value: "Deploys" },
        { op: "add", path: "/steps/2", value: { id: "board", kind: "lesson", title: "Boards", teaches_fact_ids: ["f3"] } },
        { op: "remove", path: "/desc" },
      ],
      approved,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.steps.map((s) => s.id)).toEqual(["welcome", "deploys", "board", "deploys-quiz", "done"]);
    expect(r.spec.steps[1].title).toBe("Deploys");
    expect(r.spec.desc).toBeUndefined();
  });

  it("rejects bad paths and results that break the generation rules", () => {
    expect(applyCoursePatches(spec(), [{ op: "set", path: "/steps/9/title", value: "x" }], approved)).toMatchObject({ ok: false });
    expect(applyCoursePatches(spec(), [{ op: "set", path: "/__proto__/x", value: 1 }], approved)).toMatchObject({ ok: false });
    expect(applyCoursePatches(spec(), [{ op: "remove", path: "/steps/0" }], approved)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining("first step must be a welcome")]),
    });
    expect(applyCoursePatches(spec(), [{ op: "set", path: "/steps/1/teaches_fact_ids", value: ["stale-fact"] }], approved)).toMatchObject({ ok: false });
  });

  it("builds step-refresh patches by id that keep indexes valid", () => {
    const s = spec();
    const patches = stepRefreshPatches(s, [{ ...s.steps[1], body: "Prod needs a manual approve." }], ["deploys-quiz"]);
    expect(patches.map((p) => `${p.op} ${p.path}`)).toEqual(["set /steps/1", "remove /steps/2"]);
    const r = applyCoursePatches(s, patches, approved);
    expect(r.ok && r.spec.steps.map((x) => x.id)).toEqual(["welcome", "deploys", "done"]);
  });
});

describe("step refresh output", () => {
  it("normalises the ways models mark removals and drops steps that weren't asked for", () => {
    const raw = { steps: [{ id: "a", kind: "lesson" }, { id: "b", remove: true }, "c", { id: "welcome", kind: "welcome" }] };
    expect(normaliseRefresh(raw, ["a", "b", "c"])).toEqual({ steps: [{ id: "a", kind: "lesson" }], remove: ["b", "c"] });
  });
});

describe("course prompts", () => {
  it("keeps the system prompts byte-identical (changing one creates a new Mubit task)", () => {
    expect({ COURSE_SYSTEM_PROMPT, COURSE_STEPS_SYSTEM_PROMPT }).toMatchSnapshot();
  });
});
