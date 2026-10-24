import type { Badge, Condition, FlowSpec, ShowIf, Step, StepType } from "./spec";

// Deterministic gamification rules. Nothing here is model-driven: the spec only chooses
// which mechanics are on and may override per-step points.
//
// Answer shapes by step type:
//   single_choice -> option id (string)
//   multiple_choice, checklist, quiz_question -> ids (string[])
//   text_input, email_signup -> string
//   welcome, feature_tour, reward -> true
//
// Streaks (both are derived, never stored by hand):
//   streak     = run of consecutively completed steps, in flow order, ending at the most recent
//                step with an outcome. A skipped step resets it. welcome and reward do not count.
//   quizStreak = run of consecutive correct quiz answers. A wrong or skipped quiz resets it.

export type AnswerValue = string | string[] | true;
export type Answers = Record<string, AnswerValue>;
export type Outcome = "completed" | "skipped";

export const BASE_POINTS: Record<StepType, number> = {
  welcome: 0,
  single_choice: 10,
  multiple_choice: 10,
  text_input: 15,
  email_signup: 25,
  feature_tour: 10,
  checklist: 5, // per ticked item
  quiz_question: 20, // when correct
  reward: 0,
};

/** Points for a wrong quiz answer: a quarter of the correct award, rounded (5 by default). */
export function quizConsolation(correctAward: number): number {
  return Math.round(correctAward / 4);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

function asArray(v: AnswerValue | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

export function isAnswered(v: AnswerValue | undefined): boolean {
  if (v === undefined) return false;
  if (v === true) return true;
  if (Array.isArray(v)) return v.length > 0;
  return v.trim().length > 0;
}

export function isQuizCorrect(step: Step, answer: AnswerValue | undefined): boolean {
  if (step.type !== "quiz_question") return false;
  const picked = new Set(asArray(answer));
  return picked.size === step.correctOptionIds.length && step.correctOptionIds.every((id) => picked.has(id));
}

/** Points a completed step is worth given its answer. Overrides replace the base award. */
export function stepPoints(step: Step, answer: AnswerValue | undefined): number {
  const award = step.points ?? BASE_POINTS[step.type];
  switch (step.type) {
    case "checklist": {
      const ids = new Set(step.items.map((i) => i.id));
      return asArray(answer).filter((id) => ids.has(id)).length * award;
    }
    case "quiz_question":
      return isQuizCorrect(step, answer) ? award : quizConsolation(award);
    default:
      return award;
  }
}

/** Whether the current answer lets the user continue past this step. */
export function canAdvance(step: Step, answer: AnswerValue | undefined): boolean {
  switch (step.type) {
    case "welcome":
    case "feature_tour":
    case "reward":
      return true;
    case "single_choice":
      return typeof answer === "string" && step.options.some((o) => o.id === answer);
    case "multiple_choice": {
      const n = asArray(answer).length;
      return n >= (step.minSelect ?? 1) && n <= (step.maxSelect ?? step.options.length);
    }
    case "text_input":
      return typeof answer === "string" && answer.trim().length > 0;
    case "email_signup":
      return typeof answer === "string" && isValidEmail(answer);
    case "checklist": {
      const n = asArray(answer).length;
      return step.requireAll ? n === step.items.length : n >= 1;
    }
    case "quiz_question":
      return asArray(answer).length > 0;
  }
}

export function isSkippable(step: Step): boolean {
  if (step.type === "welcome" || step.type === "reward") return false;
  return step.optional === true || step.type === "email_signup";
}

export function evalCondition(c: Condition, answers: Answers): boolean {
  const a = answers[c.stepId];
  switch (c.op) {
    case "answered":
      return isAnswered(a);
    case "equals":
      return Array.isArray(a) ? a.length === 1 && a[0] === c.value : a === c.value;
    case "not_equals":
      return !(Array.isArray(a) ? a.length === 1 && a[0] === c.value : a === c.value);
    case "includes":
      if (Array.isArray(a)) return c.value !== undefined && a.includes(c.value);
      if (typeof a === "string" && c.value !== undefined) return a.toLowerCase().includes(c.value.toLowerCase());
      return false;
  }
}

export function evalShowIf(showIf: ShowIf | undefined, answers: Answers): boolean {
  if (!showIf) return true;
  if (showIf.all && !showIf.all.every((c) => evalCondition(c, answers))) return false;
  if (showIf.any && showIf.any.length > 0 && !showIf.any.some((c) => evalCondition(c, answers))) return false;
  return true;
}

export function visibleSteps(spec: FlowSpec, answers: Answers): Step[] {
  return spec.steps.filter((s) => evalShowIf(s.showIf, answers));
}

function isCountable(step: Step): boolean {
  return step.type !== "welcome" && step.type !== "reward";
}

export interface Derived {
  points: number;
  streak: number;
  bestStreak: number;
  quizStreak: number;
  bestQuizStreak: number;
  quizCorrect: number;
  quizAnswered: number;
  /** Completed steps excluding welcome and reward. */
  stepsCompleted: number;
}

/** Recompute every score from answers and outcomes. Hidden steps never count. */
export function derive(spec: FlowSpec, answers: Answers, outcomes: Record<string, Outcome>): Derived {
  const d: Derived = { points: 0, streak: 0, bestStreak: 0, quizStreak: 0, bestQuizStreak: 0, quizCorrect: 0, quizAnswered: 0, stepsCompleted: 0 };
  for (const step of visibleSteps(spec, answers)) {
    const outcome = outcomes[step.id];
    if (!outcome) continue;
    const done = outcome === "completed";
    if (done) d.points += stepPoints(step, answers[step.id]);
    if (isCountable(step)) {
      if (done) d.stepsCompleted += 1;
      d.streak = done ? d.streak + 1 : 0;
      d.bestStreak = Math.max(d.bestStreak, d.streak);
    }
    if (step.type === "quiz_question") {
      const correct = done && isQuizCorrect(step, answers[step.id]);
      if (done) d.quizAnswered += 1;
      if (correct) d.quizCorrect += 1;
      d.quizStreak = correct ? d.quizStreak + 1 : 0;
      d.bestQuizStreak = Math.max(d.bestQuizStreak, d.quizStreak);
    }
  }
  return d;
}

export function badgeEarned(badge: Badge, d: Derived, outcomes: Record<string, Outcome>): boolean {
  const r = badge.rule;
  switch (r.kind) {
    case "steps_completed":
      return d.stepsCompleted >= r.count;
    case "step_completed":
      return outcomes[r.stepId] === "completed";
    case "points_at_least":
      return d.points >= r.points;
    case "quiz_correct":
      return d.quizCorrect >= r.count;
  }
}

/** Badges are sticky: once earned they stay, even if a later edit lowers the score. */
export function evaluateBadges(spec: FlowSpec, d: Derived, outcomes: Record<string, Outcome>, already: string[]): string[] {
  const earned = new Set(already);
  for (const b of spec.gamification.mechanics.badges) if (badgeEarned(b, d, outcomes)) earned.add(b.id);
  return spec.gamification.mechanics.badges.map((b) => b.id).filter((id) => earned.has(id));
}

export interface FlowState extends Derived {
  spec: FlowSpec;
  currentIndex: number;
  answers: Answers;
  outcomes: Record<string, Outcome>;
  /** Completed step ids in the order they were first completed. */
  completedStepIds: string[];
  earnedBadgeIds: string[];
  /** Badges earned by the most recent action, for toasts. */
  newBadgeIds: string[];
  /** Points delta of the most recent action. */
  lastAward: number;
  /** Indexes of previously visited steps, for back. */
  history: number[];
  /** +1 after next/skip, -1 after back. Used to orient slide transitions. */
  direction: 1 | -1;
  finished: boolean;
}

export type FlowAction =
  | { type: "answer"; value: AnswerValue }
  | { type: "next" }
  | { type: "back" }
  | { type: "skip" }
  | { type: "restart" };

export function initFlowState(spec: FlowSpec, initialIndex = 0): FlowState {
  const answers: Answers = {};
  const outcomes: Record<string, Outcome> = {};
  const target = Math.max(0, Math.min(initialIndex, spec.steps.length - 1));
  const history: number[] = [];
  for (let i = 0; i < target; i++) if (evalShowIf(spec.steps[i].showIf, answers)) history.push(i);
  return {
    spec,
    currentIndex: target,
    answers,
    outcomes,
    completedStepIds: [],
    earnedBadgeIds: [],
    newBadgeIds: [],
    lastAward: 0,
    history,
    direction: 1,
    finished: false,
    ...derive(spec, answers, outcomes),
  };
}

export function currentStep(state: FlowState): Step {
  return state.spec.steps[state.currentIndex];
}

export function nextVisibleIndex(spec: FlowSpec, from: number, answers: Answers): number {
  for (let i = from + 1; i < spec.steps.length; i++) if (evalShowIf(spec.steps[i].showIf, answers)) return i;
  return -1;
}

function settle(prev: FlowState, answers: Answers, outcomes: Record<string, Outcome>, patch: Partial<FlowState>): FlowState {
  const d = derive(prev.spec, answers, outcomes);
  const earned = evaluateBadges(prev.spec, d, outcomes, prev.earnedBadgeIds);
  return {
    ...prev,
    ...patch,
    ...d,
    answers,
    outcomes,
    earnedBadgeIds: earned,
    newBadgeIds: earned.filter((id) => !prev.earnedBadgeIds.includes(id)),
    lastAward: d.points - prev.points,
  };
}

function advance(state: FlowState, outcome: Outcome): FlowState {
  const step = currentStep(state);
  const answers = { ...state.answers };
  if (outcome === "completed" && answers[step.id] === undefined && (step.type === "welcome" || step.type === "feature_tour" || step.type === "reward"))
    answers[step.id] = true;
  const outcomes = { ...state.outcomes, [step.id]: outcome };
  const completedStepIds =
    outcome === "completed" && !state.completedStepIds.includes(step.id)
      ? [...state.completedStepIds, step.id]
      : outcome === "skipped"
        ? state.completedStepIds.filter((id) => id !== step.id)
        : state.completedStepIds;
  const next = nextVisibleIndex(state.spec, state.currentIndex, answers);
  if (next === -1) return settle(state, answers, outcomes, { completedStepIds, finished: true, direction: 1 });
  return settle(state, answers, outcomes, {
    completedStepIds,
    currentIndex: next,
    history: [...state.history, state.currentIndex],
    direction: 1,
  });
}

export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case "restart":
      return initFlowState(state.spec);
    case "answer": {
      if (state.finished) return state;
      const step = currentStep(state);
      // A checked quiz answer is final, so going back cannot farm points.
      if (step.type === "quiz_question" && state.outcomes[step.id] === "completed") return state;
      return { ...state, answers: { ...state.answers, [step.id]: action.value }, newBadgeIds: [], lastAward: 0 };
    }
    case "next": {
      if (state.finished) return state;
      const step = currentStep(state);
      if (!canAdvance(step, state.answers[step.id])) return state;
      return advance(state, "completed");
    }
    case "skip": {
      if (state.finished) return state;
      if (!isSkippable(currentStep(state))) return state;
      return advance(state, "skipped");
    }
    case "back": {
      if (state.finished || state.history.length === 0) return state;
      const history = state.history.slice(0, -1);
      return { ...state, currentIndex: state.history[state.history.length - 1], history, direction: -1, newBadgeIds: [], lastAward: 0 };
    }
  }
}

/** Highest score reachable on the current branch, for "x of y" displays. */
export function maxPoints(spec: FlowSpec, answers: Answers): number {
  return visibleSteps(spec, answers).reduce((sum, s) => {
    const award = s.points ?? BASE_POINTS[s.type];
    return sum + (s.type === "checklist" ? award * s.items.length : award);
  }, 0);
}
