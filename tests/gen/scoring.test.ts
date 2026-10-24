import { describe, expect, it } from "vitest";
import { sampleQuest, sampleQuiz, sampleStreak } from "@/lib/flow/sample";
import {
  BASE_POINTS,
  canAdvance,
  currentStep,
  derive,
  evalCondition,
  flowReducer,
  initFlowState,
  stepPoints,
  visibleSteps,
  type AnswerValue,
  type FlowAction,
  type FlowState,
} from "@/lib/flow/scoring";
import type { FlowSpec, Step, StepOf } from "@/lib/flow/spec";

function stepOf<T extends Step["type"]>(spec: FlowSpec, id: string, type: T): StepOf<T> {
  const s = spec.steps.find((x) => x.id === id);
  if (!s || s.type !== type) throw new Error(`fixture: ${id} is not ${type}`);
  return s as StepOf<T>;
}

const run = (state: FlowState, ...actions: FlowAction[]) => actions.reduce(flowReducer, state);

/** Walk a flow to the end: answer each step from the map (or skip it) and press next. */
function walk(spec: FlowSpec, answers: Record<string, AnswerValue | "skip">): { state: FlowState; visited: string[] } {
  let state = initFlowState(spec);
  const visited: string[] = [];
  for (let guard = 0; guard < 40 && !state.finished; guard++) {
    const step = currentStep(state);
    visited.push(step.id);
    const a = answers[step.id];
    if (a === "skip") {
      state = flowReducer(state, { type: "skip" });
      continue;
    }
    if (a !== undefined) state = flowReducer(state, { type: "answer", value: a });
    const before = state;
    state = flowReducer(state, { type: "next" });
    if (state === before) throw new Error(`stuck on ${step.id}`);
  }
  return { state, visited };
}

describe("points per step type", () => {
  it("uses the base table", () => {
    expect(BASE_POINTS).toMatchObject({
      welcome: 0,
      single_choice: 10,
      multiple_choice: 10,
      text_input: 15,
      email_signup: 25,
      feature_tour: 10,
      checklist: 5,
      quiz_question: 20,
      reward: 0,
    });
    expect(stepPoints(stepOf(sampleQuest, "set-sail", "welcome"), true)).toBe(0);
    expect(stepPoints(stepOf(sampleQuest, "trip-type", "single_choice"), "city")).toBe(10);
    expect(stepPoints(stepOf(sampleQuest, "crew", "multiple_choice"), ["friends"])).toBe(10);
    expect(stepPoints(stepOf(sampleQuest, "destination", "text_input"), "Lisbon")).toBe(15);
    expect(stepPoints(stepOf(sampleQuest, "invite", "email_signup"), "a@b.co")).toBe(25);
    expect(stepPoints(stepOf(sampleQuest, "planning-board", "feature_tour"), true)).toBe(10);
    expect(stepPoints(stepOf(sampleStreak, "setup", "checklist"), ["photo", "airport"])).toBe(10);
    expect(stepPoints(stepOf(sampleQuest, "ready", "reward"), true)).toBe(0);
  });

  it("scores quizzes 20 when correct and 5 when wrong", () => {
    const q = stepOf(sampleQuiz, "q-votes", "quiz_question");
    expect(stepPoints(q, ["vote"])).toBe(20);
    expect(stepPoints(q, ["owner"])).toBe(5);
    const multi = stepOf(sampleQuiz, "q-offline", "quiz_question");
    expect(stepPoints(multi, ["itinerary", "tickets"])).toBe(20);
    expect(stepPoints(multi, ["itinerary"])).toBe(5);
    expect(stepPoints(multi, ["itinerary", "tickets", "voting"])).toBe(5);
  });

  it("honours points overrides", () => {
    expect(stepPoints(stepOf(sampleStreak, "first-board", "checklist"), ["dates", "stay", "idea"])).toBe(18);
    const q = { ...stepOf(sampleQuiz, "q-votes", "quiz_question"), points: 40 };
    expect(stepPoints(q, ["vote"])).toBe(40);
    expect(stepPoints(q, ["first"])).toBe(10);
    expect(stepPoints({ ...stepOf(sampleQuest, "trip-type", "single_choice"), points: 0 }, "city")).toBe(0);
  });

  it("ignores checklist ids that are not items", () => {
    expect(stepPoints(stepOf(sampleStreak, "setup", "checklist"), ["photo", "bogus"])).toBe(5);
  });
});

describe("canAdvance", () => {
  it("requires a valid answer per type", () => {
    expect(canAdvance(stepOf(sampleQuest, "trip-type", "single_choice"), undefined)).toBe(false);
    expect(canAdvance(stepOf(sampleQuest, "trip-type", "single_choice"), "moon")).toBe(false);
    expect(canAdvance(stepOf(sampleQuest, "destination", "text_input"), "   ")).toBe(false);
    expect(canAdvance(stepOf(sampleQuest, "invite", "email_signup"), "not-an-email")).toBe(false);
    expect(canAdvance(stepOf(sampleQuest, "invite", "email_signup"), "sam@example.com")).toBe(true);
    const notify = stepOf(sampleStreak, "notify", "multiple_choice");
    expect(canAdvance(notify, ["votes", "prices", "packing"])).toBe(false);
    expect(canAdvance(notify, ["votes"])).toBe(true);
    expect(canAdvance({ ...stepOf(sampleStreak, "setup", "checklist"), requireAll: true }, ["photo"])).toBe(false);
  });
});

describe("branching", () => {
  it("evaluates conditions", () => {
    const answers = { a: "x", b: ["p", "q"], c: "Lisbon trip" };
    expect(evalCondition({ stepId: "a", op: "equals", value: "x" }, answers)).toBe(true);
    expect(evalCondition({ stepId: "a", op: "not_equals", value: "x" }, answers)).toBe(false);
    expect(evalCondition({ stepId: "b", op: "includes", value: "q" }, answers)).toBe(true);
    expect(evalCondition({ stepId: "b", op: "equals", value: "p" }, answers)).toBe(false);
    expect(evalCondition({ stepId: "c", op: "includes", value: "lisbon" }, answers)).toBe(true);
    expect(evalCondition({ stepId: "z", op: "answered" }, answers)).toBe(false);
    expect(evalCondition({ stepId: "z", op: "not_equals", value: "x" }, answers)).toBe(true);
  });

  it("hides a showIf step until its condition holds", () => {
    expect(visibleSteps(sampleQuest, {}).map((s) => s.id)).not.toContain("abroad-tips");
    expect(visibleSteps(sampleQuest, { "trip-type": "abroad" }).map((s) => s.id)).toContain("abroad-tips");
  });

  it("follows the branch while walking", () => {
    const base = { crew: ["friends"], destination: "Tokyo", invite: "sam@example.com" };
    const abroad = walk(sampleQuest, { ...base, "trip-type": "abroad" });
    const weekend = walk(sampleQuest, { ...base, "trip-type": "weekend" });
    expect(abroad.visited).toContain("abroad-tips");
    expect(weekend.visited).not.toContain("abroad-tips");
    expect(abroad.state.points - weekend.state.points).toBe(10);
  });

  it("drops points from steps hidden by a changed answer", () => {
    let s = run(initFlowState(sampleQuiz), { type: "next" }, { type: "next" }, { type: "answer", value: ["vote"] }, { type: "next" });
    s = run(s, { type: "next" }, { type: "answer", value: ["owe-30"] }, { type: "next" }, { type: "answer", value: "planner" }, { type: "next" });
    expect(currentStep(s).id).toBe("q-offline");
    s = run(s, { type: "answer", value: ["itinerary", "tickets"] }, { type: "next" });
    expect(s.points).toBe(10 + 20 + 10 + 20 + 10 + 20);
    s = run(s, { type: "back" }, { type: "back" }, { type: "answer", value: "tagalong" });
    const d = derive(sampleQuiz, s.answers, s.outcomes);
    expect(d.points).toBe(10 + 20 + 10 + 20 + 10);
    s = run(s, { type: "next" });
    expect(currentStep(s).id).toBe("q-invite");
    expect(s.points).toBe(70);
  });
});

describe("reducer", () => {
  it("walks the quest sample to completion with exact points and badges", () => {
    const { state, visited } = walk(sampleQuest, {
      "trip-type": "weekend",
      crew: ["friends", "family"],
      destination: "Lisbon",
      invite: "sam@example.com",
    });
    expect(visited).toEqual(["set-sail", "trip-type", "crew", "destination", "planning-board", "invite", "ready"]);
    expect(state.finished).toBe(true);
    expect(state.points).toBe(70);
    expect(state.earnedBadgeIds).toEqual(["navigator", "crew-captain", "high-tide"]);
    expect(state.completedStepIds).toEqual(visited);
    expect(state.stepsCompleted).toBe(5);
  });

  it("walks the streak sample with the checklist override and a skip", () => {
    const { state } = walk(sampleStreak, {
      setup: ["photo", "calendar"],
      "budget-style": "even",
      "first-board": ["dates", "stay", "idea", "invite-one"],
      "trip-name": "Porto, finally",
      notify: "skip",
      digest: "sam@example.com",
    });
    // 10 + 10 + 24 + 15 + 0 (skipped) + 25
    expect(state.points).toBe(84);
    expect(state.bestStreak).toBe(4);
    expect(state.streak).toBe(1);
    expect(state.earnedBadgeIds).toEqual(["on-a-roll", "organiser"]);
  });

  it("earns the streak sample's points badge only with a near-perfect run", () => {
    const { state } = walk(sampleStreak, {
      setup: ["photo", "calendar", "airport"],
      "budget-style": "even",
      "first-board": ["dates", "stay", "idea", "invite-one"],
      "trip-name": "Porto, finally",
      notify: ["votes"],
      digest: "sam@example.com",
    });
    expect(state.points).toBe(99);
    expect(state.bestStreak).toBe(6);
    expect(state.earnedBadgeIds).toEqual(["on-a-roll", "organiser", "high-scorer"]);
  });

  it("walks the quiz sample with every answer right", () => {
    const { state } = walk(sampleQuiz, {
      "q-votes": ["vote"],
      "q-split": ["owe-30"],
      role: "planner",
      "q-offline": ["tickets", "itinerary"],
      "q-invite": ["link"],
    });
    expect(state.points).toBe(10 + 20 + 10 + 20 + 10 + 20 + 20);
    expect(state.quizCorrect).toBe(4);
    expect(state.quizStreak).toBe(4);
    expect(state.earnedBadgeIds).toEqual(["explorer", "sharp-eye", "top-marks"]);
  });

  it("resets the quiz streak on a wrong answer", () => {
    const { state } = walk(sampleQuiz, {
      "q-votes": ["vote"],
      "q-split": ["owe-45"],
      role: "tagalong",
      "q-invite": ["link"],
    });
    expect(state.points).toBe(10 + 20 + 10 + 5 + 10 + 20);
    expect(state.quizCorrect).toBe(2);
    expect(state.quizStreak).toBe(1);
    expect(state.bestQuizStreak).toBe(1);
    expect(state.earnedBadgeIds).toEqual(["explorer", "sharp-eye"]);
  });

  it("does not advance without a valid answer", () => {
    const s = run(initFlowState(sampleQuest), { type: "next" });
    expect(flowReducer(s, { type: "next" })).toBe(s);
  });

  it("only skips skippable steps and breaks the streak", () => {
    let s = run(initFlowState(sampleQuest), { type: "next" });
    expect(flowReducer(s, { type: "skip" })).toBe(s);
    s = run(s, { type: "answer", value: "city" }, { type: "next" }, { type: "answer", value: ["friends"] }, { type: "next" });
    expect(s.streak).toBe(2);
    s = run(s, { type: "skip" });
    expect(s.outcomes.destination).toBe("skipped");
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(s.earnedBadgeIds).not.toContain("navigator");
  });

  it("moves back through history and keeps points", () => {
    let s = run(initFlowState(sampleQuest), { type: "next" }, { type: "answer", value: "city" }, { type: "next" });
    expect(currentStep(s).id).toBe("crew");
    expect(s.points).toBe(10);
    s = run(s, { type: "back" });
    expect(currentStep(s).id).toBe("trip-type");
    expect(s.direction).toBe(-1);
    expect(s.points).toBe(10);
    s = run(s, { type: "next" });
    expect(currentStep(s).id).toBe("crew");
    expect(s.points).toBe(10);
    expect(s.lastAward).toBe(0);
  });

  it("locks a checked quiz answer", () => {
    let s = run(initFlowState(sampleQuiz), { type: "next" }, { type: "next" }, { type: "answer", value: ["owner"] }, { type: "next" });
    expect(s.points).toBe(15);
    s = run(s, { type: "back" }, { type: "answer", value: ["vote"] });
    expect(s.answers["q-votes"]).toEqual(["owner"]);
  });

  it("reports badges once, then restarts cleanly", () => {
    let s = run(initFlowState(sampleQuest), { type: "next" }, { type: "answer", value: "city" }, { type: "next" });
    s = run(s, { type: "answer", value: ["friends"] }, { type: "next" }, { type: "answer", value: "Rome" }, { type: "next" });
    expect(s.newBadgeIds).toEqual(["navigator"]);
    s = run(s, { type: "next" });
    expect(s.newBadgeIds).toEqual(["crew-captain"]);
    expect(s.earnedBadgeIds).toEqual(["navigator", "crew-captain"]);
    s = run(s, { type: "restart" });
    expect(s).toEqual(initFlowState(sampleQuest));
  });

  it("starts at initialIndex with a back history", () => {
    const s = initFlowState(sampleQuest, 3);
    expect(currentStep(s).id).toBe("destination");
    expect(s.history).toEqual([0, 1, 2]);
  });

  it("is pure", () => {
    const s0 = initFlowState(sampleQuest);
    const snapshot = structuredClone(s0);
    run(s0, { type: "next" }, { type: "answer", value: "city" }, { type: "next" });
    expect(s0).toEqual(snapshot);
  });
});
