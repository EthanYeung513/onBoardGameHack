import { describe, expect, it } from "vitest";
import { SAMPLE_SPECS, sampleQuest, sampleQuiz } from "@/lib/flow/sample";
import { flowSpecJsonSchema, validateFlowSpec, type FlowSpec } from "@/lib/flow/spec";

const clone = <T,>(v: T): T => structuredClone(v);

function errorsFor(spec: unknown): string[] {
  const r = validateFlowSpec(spec);
  if (r.ok) throw new Error("expected the spec to be rejected");
  return r.errors;
}

describe("FlowSpec validation", () => {
  it.each(SAMPLE_SPECS.map((s) => [s.variantKey, s] as const))("accepts the %s sample", (_key, spec) => {
    const r = validateFlowSpec(spec);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it("accepts a JSON string", () => {
    expect(validateFlowSpec(JSON.stringify(sampleQuest)).ok).toBe(true);
  });

  it("reports invalid JSON text", () => {
    expect(errorsFor("{ nope")[0]).toMatch(/not valid JSON/);
  });

  it("rejects unknown keys, bad slugs, unknown step types and transitions with a path", () => {
    const s = clone(sampleQuest) as unknown as Record<string, unknown> & { steps: Record<string, unknown>[] };
    s.extra = 1;
    s.steps[1].id = "Trip Type";
    s.steps[2].transition = "spin";
    const errs = errorsFor(s);
    expect(errs.some((e) => e.startsWith("(root)") && /extra/.test(e))).toBe(true);
    expect(errs.some((e) => e.startsWith("steps[1].id"))).toBe(true);
    expect(errs.some((e) => e.startsWith("steps[2].transition"))).toBe(true);
  });

  it("rejects too few and too many steps", () => {
    const few = clone(sampleQuest);
    few.steps = few.steps.slice(0, 2);
    expect(errorsFor(few).join("\n")).toMatch(/steps/);
    const many = clone(sampleQuest);
    many.steps = Array.from({ length: 13 }, (_, i) => ({ ...sampleQuest.steps[5], id: `tour-${i}` }));
    expect(errorsFor(many).join("\n")).toMatch(/steps/);
  });

  it("rejects duplicate step ids", () => {
    const s = clone(sampleQuest);
    s.steps[3].id = "crew";
    expect(errorsFor(s).join("\n")).toMatch(/duplicate step id "crew"/);
  });

  it("rejects showIf that references a later step", () => {
    const s = clone(sampleQuest);
    s.steps[2].showIf = { all: [{ stepId: "destination", op: "answered" }] };
    expect(errorsFor(s).join("\n")).toMatch(/showIf references "destination", which does not come before this step/);
  });

  it("rejects showIf that references itself or an unknown step", () => {
    const s = clone(sampleQuest);
    s.steps[2].showIf = { all: [{ stepId: "crew", op: "answered" }] };
    s.steps[3].showIf = { any: [{ stepId: "ghost", op: "answered" }] };
    const msg = errorsFor(s).join("\n");
    expect(msg).toMatch(/"crew", which does not come before/);
    expect(msg).toMatch(/unknown step "ghost"/);
  });

  it("rejects a showIf value that is not an option id and a missing value", () => {
    const s = clone(sampleQuest);
    s.steps[4].showIf = { all: [{ stepId: "trip-type", op: "equals", value: "moon" }] };
    s.steps[5].showIf = { all: [{ stepId: "trip-type", op: "equals" }] };
    const msg = errorsFor(s).join("\n");
    expect(msg).toMatch(/value "moon" is not an option id of "trip-type"/);
    expect(msg).toMatch(/"equals" on "trip-type" needs a value/);
  });

  it("rejects an empty showIf", () => {
    const s = clone(sampleQuest);
    s.steps[3].showIf = {};
    expect(errorsFor(s).join("\n")).toMatch(/showIf needs at least one condition/);
  });

  it("rejects quiz correct ids that are not options", () => {
    const s = clone(sampleQuiz);
    const q = s.steps.find((x) => x.id === "q-votes");
    if (q?.type !== "quiz_question") throw new Error("fixture");
    q.correctOptionIds = ["voting"];
    expect(errorsFor(s).join("\n")).toMatch(/correct option "voting" is not one of its options/);
  });

  it("rejects badge rules that reference unknown steps", () => {
    const s = clone(sampleQuest);
    s.gamification.mechanics.badges[0].rule = { kind: "step_completed", stepId: "nowhere" };
    expect(errorsFor(s).join("\n")).toMatch(/badges\[0\] \("navigator"\): rule references unknown step "nowhere"/);
  });

  it("rejects quiz_correct badges that need more quizzes than exist", () => {
    const s = clone(sampleQuest);
    s.gamification.mechanics.badges[0].rule = { kind: "quiz_correct", count: 1 };
    expect(errorsFor(s).join("\n")).toMatch(/needs 1 correct quiz answers but the flow has 0/);
  });

  it("rejects points badges the flow can never award", () => {
    const s = clone(sampleQuest);
    s.gamification.mechanics.badges[2].rule = { kind: "points_at_least", points: 500 };
    expect(errorsFor(s).join("\n")).toMatch(/needs 500 points but the flow can award at most 80/);
  });

  it("requires welcome first and reward last", () => {
    const s = clone(sampleQuest);
    s.steps = [...s.steps.slice(1), s.steps[0]];
    const msg = errorsFor(s).join("\n");
    expect(msg).toMatch(/first step must be "welcome", got "single_choice"/);
    expect(msg).toMatch(/last step must be "reward", got "welcome"/);
  });

  it("allows at most one email_signup", () => {
    const s = clone(sampleQuest) as FlowSpec;
    const email = s.steps.find((x) => x.type === "email_signup")!;
    s.steps.splice(5, 0, { ...email, id: "invite-again" });
    expect(errorsFor(s).join("\n")).toMatch(/at most one email_signup step is allowed, found 2 \(invite-again, invite\)/);
  });

  it("rejects duplicate option ids inside a step", () => {
    const s = clone(sampleQuest);
    const step = s.steps[1];
    if (step.type !== "single_choice") throw new Error("fixture");
    step.options[1].id = step.options[0].id;
    expect(errorsFor(s).join("\n")).toMatch(/duplicate option id "weekend"/);
  });

  it("exports a JSON Schema with the step union", () => {
    const schema = flowSpecJsonSchema as Record<string, unknown>;
    expect(schema.type).toBe("object");
    const text = JSON.stringify(schema);
    for (const t of ["welcome", "quiz_question", "reward", "path_map", "points_at_least", "morph"]) expect(text).toContain(t);
    expect((schema.required as string[]).sort()).toEqual(["gamification", "steps", "tagline", "title", "variantKey"]);
  });
});
