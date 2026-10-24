import type { DesignTokens } from "@/lib/schemas/tokens";
import type { FlowSpec } from "./spec";
import { flowCssVars, googleFontsHref } from "./theme";

// Turns a spec plus tokens into files that run outside this app: a single JSX component that
// needs only `react` and `motion`, the raw spec, and a theme stylesheet.
//
// SCORING_RUNTIME is a plain JS mirror of scoring.ts. tests/gen/export.test.ts replays the same
// actions through both and fails if they ever disagree.

export interface ExportFile {
  path: string;
  content: string;
}

export const SCORING_RUNTIME = String.raw`
const BASE_POINTS = { welcome: 0, single_choice: 10, multiple_choice: 10, text_input: 15, email_signup: 25, feature_tour: 10, checklist: 5, quiz_question: 20, reward: 0 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function quizConsolation(award) { return Math.round(award / 4); }
function isValidEmail(v) { return EMAIL_RE.test(String(v).trim()); }
function asArray(v) { return Array.isArray(v) ? v : typeof v === "string" ? [v] : []; }
function isAnswered(v) {
  if (v === undefined) return false;
  if (v === true) return true;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim().length > 0;
}
function isQuizCorrect(step, answer) {
  if (step.type !== "quiz_question") return false;
  const picked = new Set(asArray(answer));
  return picked.size === step.correctOptionIds.length && step.correctOptionIds.every((id) => picked.has(id));
}
function stepPoints(step, answer) {
  const award = step.points !== undefined ? step.points : BASE_POINTS[step.type];
  if (step.type === "checklist") {
    const ids = new Set(step.items.map((i) => i.id));
    return asArray(answer).filter((id) => ids.has(id)).length * award;
  }
  if (step.type === "quiz_question") return isQuizCorrect(step, answer) ? award : quizConsolation(award);
  return award;
}
function canAdvance(step, answer) {
  switch (step.type) {
    case "welcome": case "feature_tour": case "reward": return true;
    case "single_choice": return typeof answer === "string" && step.options.some((o) => o.id === answer);
    case "multiple_choice": {
      const n = asArray(answer).length;
      return n >= (step.minSelect || 1) && n <= (step.maxSelect || step.options.length);
    }
    case "text_input": return typeof answer === "string" && answer.trim().length > 0;
    case "email_signup": return typeof answer === "string" && isValidEmail(answer);
    case "checklist": {
      const n = asArray(answer).length;
      return step.requireAll ? n === step.items.length : n >= 1;
    }
    case "quiz_question": return asArray(answer).length > 0;
    default: return false;
  }
}
function isSkippable(step) {
  if (step.type === "welcome" || step.type === "reward") return false;
  return step.optional === true || step.type === "email_signup";
}
function sameAs(a, value) { return Array.isArray(a) ? a.length === 1 && a[0] === value : a === value; }
function evalCondition(c, answers) {
  const a = answers[c.stepId];
  switch (c.op) {
    case "answered": return isAnswered(a);
    case "equals": return sameAs(a, c.value);
    case "not_equals": return !sameAs(a, c.value);
    case "includes":
      if (Array.isArray(a)) return c.value !== undefined && a.includes(c.value);
      if (typeof a === "string" && c.value !== undefined) return a.toLowerCase().includes(c.value.toLowerCase());
      return false;
    default: return false;
  }
}
function evalShowIf(showIf, answers) {
  if (!showIf) return true;
  if (showIf.all && !showIf.all.every((c) => evalCondition(c, answers))) return false;
  if (showIf.any && showIf.any.length > 0 && !showIf.any.some((c) => evalCondition(c, answers))) return false;
  return true;
}
function visibleSteps(spec, answers) { return spec.steps.filter((s) => evalShowIf(s.showIf, answers)); }
function derive(spec, answers, outcomes) {
  const d = { points: 0, streak: 0, bestStreak: 0, quizStreak: 0, bestQuizStreak: 0, quizCorrect: 0, quizAnswered: 0, stepsCompleted: 0 };
  for (const step of visibleSteps(spec, answers)) {
    const outcome = outcomes[step.id];
    if (!outcome) continue;
    const done = outcome === "completed";
    if (done) d.points += stepPoints(step, answers[step.id]);
    if (step.type !== "welcome" && step.type !== "reward") {
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
function badgeEarned(badge, d, outcomes) {
  const r = badge.rule;
  switch (r.kind) {
    case "steps_completed": return d.stepsCompleted >= r.count;
    case "step_completed": return outcomes[r.stepId] === "completed";
    case "points_at_least": return d.points >= r.points;
    case "quiz_correct": return d.quizCorrect >= r.count;
    default: return false;
  }
}
function evaluateBadges(spec, d, outcomes, already) {
  const earned = new Set(already);
  for (const b of spec.gamification.mechanics.badges) if (badgeEarned(b, d, outcomes)) earned.add(b.id);
  return spec.gamification.mechanics.badges.map((b) => b.id).filter((id) => earned.has(id));
}
function initFlowState(spec, initialIndex) {
  const target = Math.max(0, Math.min(initialIndex || 0, spec.steps.length - 1));
  const history = [];
  for (let i = 0; i < target; i++) if (evalShowIf(spec.steps[i].showIf, {})) history.push(i);
  return Object.assign(
    { spec, currentIndex: target, answers: {}, outcomes: {}, completedStepIds: [], earnedBadgeIds: [], newBadgeIds: [], lastAward: 0, history, direction: 1, finished: false },
    derive(spec, {}, {})
  );
}
function currentStep(state) { return state.spec.steps[state.currentIndex]; }
function nextVisibleIndex(spec, from, answers) {
  for (let i = from + 1; i < spec.steps.length; i++) if (evalShowIf(spec.steps[i].showIf, answers)) return i;
  return -1;
}
function settle(prev, answers, outcomes, patch) {
  const d = derive(prev.spec, answers, outcomes);
  const earned = evaluateBadges(prev.spec, d, outcomes, prev.earnedBadgeIds);
  return Object.assign({}, prev, patch, d, {
    answers, outcomes, earnedBadgeIds: earned,
    newBadgeIds: earned.filter((id) => !prev.earnedBadgeIds.includes(id)),
    lastAward: d.points - prev.points,
  });
}
function advance(state, outcome) {
  const step = currentStep(state);
  const answers = Object.assign({}, state.answers);
  if (outcome === "completed" && answers[step.id] === undefined && (step.type === "welcome" || step.type === "feature_tour" || step.type === "reward")) answers[step.id] = true;
  const outcomes = Object.assign({}, state.outcomes, { [step.id]: outcome });
  const completedStepIds =
    outcome === "completed" && !state.completedStepIds.includes(step.id) ? state.completedStepIds.concat(step.id)
    : outcome === "skipped" ? state.completedStepIds.filter((id) => id !== step.id)
    : state.completedStepIds;
  const next = nextVisibleIndex(state.spec, state.currentIndex, answers);
  if (next === -1) return settle(state, answers, outcomes, { completedStepIds, finished: true, direction: 1 });
  return settle(state, answers, outcomes, { completedStepIds, currentIndex: next, history: state.history.concat(state.currentIndex), direction: 1 });
}
function flowReducer(state, action) {
  switch (action.type) {
    case "restart": return initFlowState(state.spec, 0);
    case "answer": {
      if (state.finished) return state;
      const step = currentStep(state);
      if (step.type === "quiz_question" && state.outcomes[step.id] === "completed") return state;
      return Object.assign({}, state, { answers: Object.assign({}, state.answers, { [step.id]: action.value }), newBadgeIds: [], lastAward: 0 });
    }
    case "next": {
      if (state.finished) return state;
      const step = currentStep(state);
      if (!canAdvance(step, state.answers[step.id])) return state;
      return advance(state, "completed");
    }
    case "skip": {
      if (state.finished || !isSkippable(currentStep(state))) return state;
      return advance(state, "skipped");
    }
    case "back": {
      if (state.finished || state.history.length === 0) return state;
      return Object.assign({}, state, { currentIndex: state.history[state.history.length - 1], history: state.history.slice(0, -1), direction: -1, newBadgeIds: [], lastAward: 0 });
    }
    default: return state;
  }
}
`;

export const COMPONENT_CSS = String.raw`.ob-root, .ob-root * { box-sizing: border-box; }
.ob-root { position: relative; isolation: isolate; display: flex; flex-direction: column; width: 100%; max-width: 560px; min-height: 540px; margin: 0 auto; overflow: hidden; font-family: var(--ob-font-body); font-size: var(--ob-font-size); line-height: 1.5; color: var(--ob-text); background: var(--ob-surface); border: 1px solid var(--ob-border); border-radius: var(--ob-radius-lg); box-shadow: var(--ob-shadow); -webkit-font-smoothing: antialiased; }
.ob-root :where(button) { font: inherit; color: inherit; cursor: pointer; }
.ob-root :focus-visible { outline: 2px solid var(--ob-primary); outline-offset: 2px; }
.ob-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.ob-header { display: grid; gap: .875em; padding: 1.1em 1.25em .25em; }
.ob-topline { display: flex; align-items: center; justify-content: space-between; gap: .75em; }
.ob-flow-title { margin: 0; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-family: var(--ob-font-heading); font-weight: var(--ob-heading-weight); font-size: .9375em; }
.ob-chips { display: flex; flex-shrink: 0; align-items: center; gap: .4em; }
.ob-chip { display: inline-flex; align-items: center; gap: .3em; padding: .3em .7em .3em .55em; border-radius: 999px; font-size: .875em; font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--ob-primary) 12%, var(--ob-surface)); }
.ob-chip b { font-weight: 600; }
.ob-unit { color: var(--ob-muted); }
.ob-streak { font-weight: 600; color: var(--ob-muted); background: color-mix(in srgb, var(--ob-muted) 8%, var(--ob-surface)); }
.ob-streak[data-lit="true"] { color: var(--ob-accent); background: color-mix(in srgb, var(--ob-accent) 14%, var(--ob-surface)); }
.ob-float { position: absolute; top: 0; right: .6em; font-size: .8125em; font-weight: 700; color: var(--ob-primary); pointer-events: none; }
.ob-bar { display: flex; align-items: center; gap: .75em; }
.ob-segs { display: flex; flex: 1; gap: 3px; }
.ob-seg { position: relative; flex: 1; height: 6px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--ob-muted) 16%, var(--ob-surface)); }
.ob-seg > span { position: absolute; inset: 0; border-radius: 999px; transform-origin: left; background: var(--ob-primary); }
.ob-seg[data-state="missed"] > span { background: var(--ob-accent); }
.ob-seg[data-state="skipped"] > span { background: repeating-linear-gradient(135deg, color-mix(in srgb, var(--ob-muted) 45%, var(--ob-surface)) 0 3px, transparent 3px 6px); }
.ob-count { flex-shrink: 0; font-size: .75em; color: var(--ob-muted); font-variant-numeric: tabular-nums; }
.ob-map { display: block; width: 100%; height: auto; max-height: 64px; }
.ob-form { display: flex; flex: 1; flex-direction: column; margin: 0; }
.ob-stage { position: relative; display: flex; flex: 1; flex-direction: column; padding: 1em 1.25em 1.25em; }
.ob-stage[data-hero="true"] { justify-content: center; }
.ob-step { display: grid; gap: 1.1em; }
.ob-head { display: grid; gap: .45em; }
.ob-head[data-hero="true"] { justify-items: center; gap: .6em; padding-top: .75em; text-align: center; }
.ob-title { margin: 0; font-family: var(--ob-font-heading); font-weight: var(--ob-heading-weight); font-size: 1.45em; line-height: 1.15; letter-spacing: -0.01em; text-wrap: balance; }
.ob-head[data-hero="true"] .ob-title { font-size: 1.85em; }
.ob-body { margin: 0; max-width: 46ch; line-height: 1.6; color: var(--ob-muted); text-wrap: pretty; }
.ob-head[data-hero="true"] .ob-body { max-width: 30ch; }
.ob-hero-wrap { position: relative; }
.ob-hero { position: relative; display: grid; place-items: center; width: 2.1em; height: 2.1em; font-size: 2.2em; border-radius: var(--ob-radius-lg); background: color-mix(in srgb, var(--ob-primary) 12%, var(--ob-surface)); }
.ob-hero[data-reward="true"] { background: var(--ob-primary); box-shadow: 0 0 0 6px color-mix(in srgb, var(--ob-primary) 16%, var(--ob-surface)); }
.ob-list { display: grid; gap: .5em; min-width: 0; margin: 0; padding: 0; border: 0; list-style: none; }
.ob-option { display: flex; align-items: center; gap: .75em; padding: .7em .875em; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); background: var(--ob-surface); cursor: pointer; transition: border-color .15s, background-color .15s, opacity .15s; }
.ob-option:hover { border-color: color-mix(in srgb, var(--ob-primary) 40%, var(--ob-border)); }
.ob-option:has(:focus-visible), .ob-check:has(:focus-visible) { outline: 2px solid var(--ob-primary); outline-offset: 2px; }
.ob-option[data-state="on"], .ob-option[data-state="correct"] { border-color: var(--ob-primary); background: color-mix(in srgb, var(--ob-primary) 9%, var(--ob-surface)); box-shadow: inset 3px 0 0 var(--ob-primary); }
.ob-option[data-state="wrong"] { border-color: var(--ob-accent); background: color-mix(in srgb, var(--ob-accent) 9%, var(--ob-surface)); box-shadow: inset 3px 0 0 var(--ob-accent); }
.ob-option[data-state="answer"] { border-color: var(--ob-primary); border-style: dashed; }
.ob-option[data-dim="true"] { opacity: .5; }
.ob-option[data-locked="true"] { cursor: default; }
.ob-emoji { display: grid; flex-shrink: 0; place-items: center; width: 2.25em; height: 2.25em; font-size: 1.1em; border-radius: var(--ob-radius-sm); background: color-mix(in srgb, var(--ob-muted) 8%, var(--ob-surface)); }
.ob-option[data-state="on"] .ob-emoji, .ob-option[data-state="correct"] .ob-emoji { background: color-mix(in srgb, var(--ob-primary) 16%, var(--ob-surface)); }
.ob-option[data-state="wrong"] .ob-emoji { background: color-mix(in srgb, var(--ob-accent) 16%, var(--ob-surface)); }
.ob-label { flex: 1; min-width: 0; line-height: 1.35; }
.ob-mark { display: grid; flex-shrink: 0; place-items: center; width: 1.375em; height: 1.375em; border: 1.5px solid color-mix(in srgb, var(--ob-muted) 45%, var(--ob-border)); border-radius: calc(var(--ob-radius-sm) + 1px); color: var(--ob-on-primary); }
.ob-mark[data-shape="radio"] { border-radius: 999px; }
.ob-mark[data-state="on"], .ob-mark[data-state="correct"] { border-color: var(--ob-primary); background: var(--ob-primary); }
.ob-mark[data-state="wrong"] { border-color: var(--ob-accent); background: var(--ob-accent); color: var(--ob-on-accent); }
.ob-mark[data-state="answer"] { border-style: dashed; border-color: var(--ob-primary); color: var(--ob-primary); }
.ob-dot { width: .45em; height: .45em; border-radius: 999px; background: var(--ob-on-primary); }
.ob-feedback { display: flex; gap: .75em; padding: .75em .875em; border-radius: var(--ob-radius-md); background: color-mix(in srgb, var(--ob-primary) 10%, var(--ob-surface)); }
.ob-feedback[data-correct="false"] { background: color-mix(in srgb, var(--ob-accent) 10%, var(--ob-surface)); }
.ob-feedback p { margin: 0; font-size: .9375em; line-height: 1.6; }
.ob-feedback-icon { display: grid; flex-shrink: 0; place-items: center; width: 1.5em; height: 1.5em; margin-top: .1em; border-radius: 999px; background: var(--ob-primary); color: var(--ob-on-primary); }
.ob-feedback[data-correct="false"] .ob-feedback-icon { background: var(--ob-accent); color: var(--ob-on-accent); }
.ob-field { display: grid; gap: .4em; }
.ob-field label { font-size: .875em; font-weight: 500; }
.ob-input { width: 100%; padding: .7em .875em; font: inherit; color: var(--ob-text); background: transparent; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); outline: none; transition: border-color .15s, box-shadow .15s; }
.ob-input:focus { border-color: var(--ob-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ob-primary) 22%, transparent); }
.ob-hint { margin: 0; font-size: .8125em; line-height: 1.5; color: var(--ob-muted); }
.ob-card { overflow: hidden; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); background: var(--ob-surface); }
.ob-card-img { aspect-ratio: 16 / 7; width: 100%; background-size: cover; background-position: center; background-color: color-mix(in srgb, var(--ob-primary) 10%, var(--ob-surface)); }
.ob-card-row { display: flex; gap: .75em; padding: .75em .875em; }
.ob-card-row .ob-emoji { background: color-mix(in srgb, var(--ob-primary) 12%, var(--ob-surface)); }
.ob-card h3 { margin: 0; font-size: 1em; font-weight: 600; line-height: 1.35; }
.ob-card p { margin: .2em 0 0; font-size: .9375em; line-height: 1.6; color: var(--ob-muted); }
.ob-check { display: flex; align-items: flex-start; gap: .75em; padding: .65em .75em; border-radius: var(--ob-radius-md); cursor: pointer; transition: background-color .15s; }
.ob-check[data-state="on"] { background: color-mix(in srgb, var(--ob-primary) 9%, var(--ob-surface)); }
.ob-check-text { flex: 1; min-width: 0; line-height: 1.35; }
.ob-check-text small { display: block; margin-top: .15em; font-size: .8125em; color: var(--ob-muted); }
.ob-pts { flex-shrink: 0; font-size: .8125em; font-weight: 600; color: var(--ob-muted); font-variant-numeric: tabular-nums; }
.ob-check[data-state="on"] .ob-pts { color: var(--ob-primary); }
.ob-footer { display: flex; align-items: center; gap: .5em; padding: .875em 1.25em; border-top: 1px solid color-mix(in srgb, var(--ob-muted) 14%, var(--ob-surface)); background: color-mix(in srgb, var(--ob-muted) 3%, var(--ob-surface)); }
.ob-spacer { flex: 1; }
.ob-back { display: inline-flex; align-items: center; justify-content: center; width: 2.6em; height: 2.6em; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); background: transparent; }
.ob-skip { padding: .6em .75em; border: 0; border-radius: var(--ob-radius-sm); background: transparent; font-size: .9375em; color: var(--ob-muted); }
.ob-skip:hover { text-decoration: underline; text-underline-offset: 4px; }
.ob-next { display: inline-flex; align-items: center; justify-content: center; min-width: 8.5em; padding: .7em 1.25em; border: 0; border-radius: var(--ob-radius-md); background: var(--ob-primary); color: var(--ob-on-primary); font-weight: 600; transition: opacity .15s, filter .15s; }
.ob-next:hover:not(:disabled) { filter: brightness(1.1); }
.ob-next:disabled { opacity: .4; cursor: not-allowed; }
.ob-ghost { display: inline-flex; align-items: center; gap: .5em; justify-self: start; padding: .65em 1.1em; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); background: transparent; font-weight: 500; }
.ob-toast { position: absolute; top: .55em; left: .75em; z-index: 20; display: flex; align-items: center; gap: .6em; max-width: calc(100% - 1.5em); padding: .35em .9em .35em .35em; border-radius: var(--ob-radius-md); background: var(--ob-text); color: var(--ob-surface); font-size: .9375em; box-shadow: 0 12px 30px -12px rgba(0, 0, 0, .45); }
.ob-toast-emoji { display: grid; flex-shrink: 0; place-items: center; width: 1.9em; height: 1.9em; border-radius: var(--ob-radius-sm); background: var(--ob-surface); box-shadow: inset 0 0 0 2px var(--ob-accent); }
.ob-toast-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ob-toast-text span { opacity: .7; }
.ob-pills { display: flex; flex-wrap: wrap; justify-content: center; gap: .5em; margin: 0; padding: 0; list-style: none; }
.ob-pills li { display: inline-flex; align-items: center; gap: .4em; padding: .35em .8em .35em .4em; border-radius: 999px; font-size: .875em; font-weight: 500; background: color-mix(in srgb, var(--ob-primary) 10%, var(--ob-surface)); }
.ob-pills li span { display: grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 999px; background: var(--ob-surface); }
.ob-summary { display: grid; gap: 1.25em; padding: 1.25em; }
.ob-summary h2 { margin: 0; font-family: var(--ob-font-heading); font-weight: var(--ob-heading-weight); font-size: 1.45em; line-height: 1.15; }
.ob-summary h3 { margin: 0; font-size: .875em; font-weight: 600; }
.ob-big { display: flex; align-items: baseline; gap: .35em; margin: .2em 0 0; color: var(--ob-muted); }
.ob-big b { font-size: 2.6em; font-weight: 600; line-height: 1; color: var(--ob-primary); font-variant-numeric: tabular-nums; }
.ob-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.5em, 1fr)); gap: 1px; margin: 0; overflow: hidden; border: 1px solid var(--ob-border); border-radius: var(--ob-radius-md); background: var(--ob-border); }
.ob-stats div { display: grid; gap: .15em; padding: .7em .875em; background: var(--ob-surface); }
.ob-stats dt { font-size: .75em; color: var(--ob-muted); }
.ob-stats dd { margin: 0; font-size: 1.15em; font-weight: 600; font-variant-numeric: tabular-nums; }
.ob-blist { display: grid; gap: .4em; margin: .5em 0 0; padding: 0; list-style: none; }
.ob-blist li { display: flex; align-items: center; gap: .7em; padding: .5em .6em; border: 1px dashed var(--ob-border); border-radius: var(--ob-radius-md); color: var(--ob-muted); }
.ob-blist li[data-earned="true"] { border-color: transparent; color: var(--ob-text); background: color-mix(in srgb, var(--ob-primary) 9%, var(--ob-surface)); }
.ob-bemoji { display: grid; place-items: center; width: 2em; height: 2em; border-radius: var(--ob-radius-sm); background: color-mix(in srgb, var(--ob-muted) 8%, var(--ob-surface)); filter: grayscale(1); opacity: .55; }
.ob-blist li[data-earned="true"] .ob-bemoji { background: var(--ob-surface); filter: none; opacity: 1; }
.ob-bname { flex: 1; font-weight: 500; }
.ob-bstate { font-size: .8125em; }
.ob-blist li[data-earned="true"] .ob-bstate { color: var(--ob-primary); }
.ob-burst { position: absolute; top: 50%; left: 50%; pointer-events: none; }
.ob-burst span { position: absolute; display: block; }
@media (prefers-reduced-motion: reduce) { .ob-root * { transition: none !important; } }
`;

// The component body. Written without template literals so it can live in String.raw.
const COMPONENT = String.raw`
const STEP_VARIANTS = {
  slide: {
    enter: (d) => ({ x: 48 * d, opacity: 0 }),
    center: { x: 0, opacity: 1, transition: { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } },
    exit: (d) => ({ x: -48 * d, opacity: 0, transition: { duration: 0.2 } }),
  },
  fade: { enter: { opacity: 0 }, center: { opacity: 1, transition: { duration: 0.35 } }, exit: { opacity: 0, transition: { duration: 0.18 } } },
  scale: {
    enter: { opacity: 0, scale: 0.92 },
    center: { opacity: 1, scale: 1, transition: { type: "spring", stiffness: 380, damping: 26 } },
    exit: { opacity: 0, scale: 1.04, transition: { duration: 0.18 } },
  },
  stagger: {
    enter: { opacity: 0 },
    center: { opacity: 1, transition: { duration: 0.2, staggerChildren: 0.07, delayChildren: 0.04 } },
    exit: { opacity: 0, transition: { duration: 0.16 } },
  },
  morph: { enter: { opacity: 0 }, center: { opacity: 1, transition: { duration: 0.3, delay: 0.05 } }, exit: { opacity: 0, transition: { duration: 0.15 } } },
};
const STAGGER_ITEM = {
  enter: { opacity: 0, y: 14 },
  center: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 32 } },
  exit: { opacity: 0 },
};

function Icon({ d, size, fill }) {
  return (
    <svg viewBox="0 0 24 24" width={size || "0.85em"} height={size || "0.85em"} fill={fill || "none"} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const CHECK = "M20 6 9 17l-5-5";
const CROSS = "M18 6 6 18M6 6l12 12";
const FLAME = "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z";
const ARROW = "m12 19-7-7 7-7M19 12H5";

function Mark({ shape, state }) {
  let inner = null;
  if (state === "wrong") inner = <Icon d={CROSS} />;
  else if (state === "on" && shape === "radio") inner = <span className="ob-dot" />;
  else if (state !== "off") inner = <Icon d={CHECK} />;
  return <span className="ob-mark" data-shape={shape} data-state={state} aria-hidden="true">{inner}</span>;
}

function asList(v) { return Array.isArray(v) ? v : typeof v === "string" ? [v] : []; }

function OptionTile({ option, name, multi, checked, locked, state, dim, onToggle, item }) {
  return (
    <motion.label variants={item} className="ob-option" data-testid={"flow-option-" + option.id} data-state={state} data-dim={dim} data-locked={locked}>
      <input className="ob-sr" type={multi ? "checkbox" : "radio"} name={name} value={option.id} checked={checked} disabled={locked} onChange={onToggle} />
      {option.emoji ? <span className="ob-emoji" aria-hidden="true">{option.emoji}</span> : null}
      <span className="ob-label">{option.label}</span>
      <Mark shape={multi ? "box" : "radio"} state={state} />
    </motion.label>
  );
}

function StepBody({ step, answer, onAnswer, revealed, item, uid, showPoints, earned }) {
  const picked = asList(answer);
  const name = uid + "-" + step.id;
  if (step.type === "single_choice" || step.type === "multiple_choice") {
    const multi = step.type === "multiple_choice";
    const toggle = (id) => {
      if (!multi) return onAnswer(id);
      if (picked.includes(id)) return onAnswer(picked.filter((p) => p !== id));
      if (step.maxSelect && picked.length >= step.maxSelect) return onAnswer(picked.slice(1).concat(id));
      onAnswer(picked.concat(id));
    };
    return (
      <fieldset className="ob-list">
        <legend className="ob-sr">{step.title}</legend>
        {step.options.map((o) => (
          <OptionTile key={o.id} option={o} name={name} multi={multi} checked={picked.includes(o.id)} locked={false} state={picked.includes(o.id) ? "on" : "off"} dim={false} onToggle={() => toggle(o.id)} item={item} />
        ))}
      </fieldset>
    );
  }
  if (step.type === "quiz_question") {
    const multi = step.correctOptionIds.length > 1;
    const correct = isQuizCorrect(step, answer);
    const toggle = (id) => {
      if (revealed) return;
      if (!multi) return onAnswer([id]);
      onAnswer(picked.includes(id) ? picked.filter((p) => p !== id) : picked.concat(id));
    };
    return (
      <div className="ob-step">
        <fieldset className="ob-list">
          <legend className="ob-sr">{step.title}</legend>
          {step.options.map((o) => {
            const isPicked = picked.includes(o.id);
            const isRight = step.correctOptionIds.includes(o.id);
            const state = revealed ? (isRight ? (isPicked ? "correct" : "answer") : isPicked ? "wrong" : "off") : isPicked ? "on" : "off";
            return <OptionTile key={o.id} option={o} name={name} multi={multi} checked={isPicked} locked={revealed} state={state} dim={revealed && !isRight && !isPicked} onToggle={() => toggle(o.id)} item={item} />;
          })}
        </fieldset>
        {revealed ? (
          <motion.div className="ob-feedback" role="status" data-testid="flow-quiz-feedback" data-correct={correct} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <span className="ob-feedback-icon" aria-hidden="true"><Icon d={correct ? CHECK : CROSS} size="0.9em" /></span>
            <p><strong>{correct ? "Correct." : "Not quite."}</strong> {step.explanation}</p>
          </motion.div>
        ) : null}
      </div>
    );
  }
  if (step.type === "text_input" || step.type === "email_signup") {
    const email = step.type === "email_signup";
    const id = name + "-input";
    const value = typeof answer === "string" ? answer : "";
    const common = {
      id, className: "ob-input", "data-testid": "flow-input", value, maxLength: step.maxLength,
      placeholder: step.placeholder || (email ? "you@example.com" : undefined),
      onChange: (e) => onAnswer(e.target.value),
    };
    return (
      <motion.div variants={item} className="ob-field">
        <label htmlFor={id}>{step.inputLabel || "Email address"}{step.optional && !email ? <span className="ob-unit"> (optional)</span> : null}</label>
        {step.multiline ? <textarea rows={3} {...common} /> : <input type={email ? "email" : "text"} autoComplete={email ? "email" : "off"} {...common} />}
        {email && step.consentText ? <p className="ob-hint">{step.consentText}</p> : null}
      </motion.div>
    );
  }
  if (step.type === "feature_tour") {
    return (
      <ol className="ob-list">
        {step.cards.map((c, i) => (
          <motion.li key={i} variants={item} className="ob-card">
            {c.imageUrl ? <div className="ob-card-img" role="img" aria-label={c.title} style={{ backgroundImage: "url(" + JSON.stringify(c.imageUrl) + ")" }} /> : null}
            <div className="ob-card-row">
              <span className="ob-emoji" aria-hidden="true">{c.emoji || "•"}</span>
              <div><h3>{c.title}</h3><p>{c.body}</p></div>
            </div>
          </motion.li>
        ))}
      </ol>
    );
  }
  if (step.type === "checklist") {
    const per = step.points !== undefined ? step.points : BASE_POINTS.checklist;
    return (
      <fieldset className="ob-list" style={{ gap: "0.375em" }}>
        <legend className="ob-sr">{step.title}</legend>
        {step.items.map((it) => {
          const on = picked.includes(it.id);
          return (
            <motion.label key={it.id} variants={item} className="ob-check" data-testid={"flow-option-" + it.id} data-state={on ? "on" : "off"}>
              <input className="ob-sr" type="checkbox" checked={on} onChange={() => onAnswer(on ? picked.filter((p) => p !== it.id) : picked.concat(it.id))} />
              <Mark shape="box" state={on ? "on" : "off"} />
              <span className="ob-check-text">{it.label}{it.hint ? <small>{it.hint}</small> : null}</span>
              {showPoints ? <span className="ob-pts">+{per}</span> : null}
            </motion.label>
          );
        })}
      </fieldset>
    );
  }
  if (step.type === "reward" && earned.length > 0) {
    return (
      <motion.ul variants={item} className="ob-pills" aria-label="Badges earned">
        {earned.map((b) => <li key={b.id}><span aria-hidden="true">{b.emoji}</span>{b.label}</li>)}
      </motion.ul>
    );
  }
  return null;
}

const BURST = Array.from({ length: 26 }, (_, i) => {
  const angle = i * 137.5 * (Math.PI / 180);
  const dist = 70 + ((i * 37) % 70);
  return {
    x: Math.cos(angle) * dist * 1.25,
    y: Math.sin(angle) * dist * 0.75 - 20,
    rot: 90 + ((i * 47) % 360),
    color: ["var(--ob-accent)", "var(--ob-primary)", "color-mix(in srgb, var(--ob-accent) 45%, var(--ob-surface))"][i % 3],
    round: i % 5 === 0,
  };
});

function Burst() {
  return (
    <div className="ob-burst" aria-hidden="true">
      {BURST.map((b, i) => (
        <motion.span
          key={i}
          style={{ width: b.round ? 8 : 6, height: b.round ? 8 : 13, marginLeft: -3, marginTop: -6, borderRadius: b.round ? 99 : 2, background: b.color }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 40, b.y + 70], opacity: [0, 1, 1, 0], rotate: b.rot * 2, scale: 1 }}
          transition={{ duration: 1.6, delay: 0.12 + (i % 6) * 0.025, ease: [0.16, 1, 0.3, 1], times: [0, 0.35, 0.8, 1] }}
        />
      ))}
    </div>
  );
}

function StepHeading({ step, spec, item, layoutId, reduce }) {
  const hero = step.type === "welcome" || step.type === "reward";
  const body = step.body || (step.type === "welcome" ? spec.tagline : undefined);
  return (
    <div className="ob-head" data-hero={hero}>
      {hero ? (
        <div className="ob-hero-wrap">
          {step.type === "reward" && !reduce ? <Burst /> : null}
          <motion.div
            variants={item}
            className="ob-hero"
            data-reward={step.type === "reward"}
            aria-hidden="true"
            initial={step.type === "reward" && !reduce ? { scale: 0.3, rotate: -12, opacity: 0 } : false}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
          >
            {step.emoji || (step.type === "reward" ? "🏆" : "👋")}
          </motion.div>
        </div>
      ) : null}
      <motion.h2 className="ob-title" layoutId={layoutId} layout={layoutId ? "position" : undefined} transition={{ layout: { type: "spring", stiffness: 320, damping: 32 } }} variants={item}>
        {step.title}
      </motion.h2>
      {body ? <motion.p className="ob-body" variants={item}>{body}</motion.p> : null}
    </div>
  );
}

function nodeStates(steps, currentId, finished, outcomes, missed) {
  return steps.map((s) => {
    if (!finished && s.id === currentId) return "current";
    if (missed.has(s.id)) return "missed";
    if (outcomes[s.id] === "completed") return "done";
    if (outcomes[s.id] === "skipped") return "skipped";
    return "todo";
  });
}

function Progress({ kind, steps, currentId, finished, outcomes, missed, reduce }) {
  const n = steps.length;
  const states = nodeStates(steps, currentId, finished, outcomes, missed);
  const pos = finished ? n : Math.max(0, steps.findIndex((s) => s.id === currentId)) + 1;
  const label = "Step " + Math.min(pos, n) + " of " + n;
  const aria = { role: "progressbar", "aria-label": "Progress", "aria-valuemin": 0, "aria-valuemax": n, "aria-valuenow": pos, "aria-valuetext": label };
  if (kind === "bar") {
    return (
      <div className="ob-bar">
        <div className="ob-segs" {...aria}>
          {states.map((st, i) => (
            <span key={steps[i].id} className="ob-seg" data-state={st}>
              <motion.span initial={false} animate={{ scaleX: st === "todo" ? 0 : st === "current" ? 0.4 : 1 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }} />
            </span>
          ))}
        </div>
        <span className="ob-count">{Math.min(pos, n)}/{n}</span>
      </div>
    );
  }
  const GAP = 46, PAD = 18, H = 58, AMP = 10;
  const w = PAD * 2 + GAP * Math.max(1, n - 1);
  const pt = (i) => [PAD + GAP * i, H / 2 + (i % 2 === 0 ? AMP : -AMP)];
  let d = "M " + pt(0)[0] + " " + pt(0)[1];
  for (let i = 1; i < n; i++) {
    const a = pt(i - 1), b = pt(i);
    d += " C " + (a[0] + GAP / 2) + " " + a[1] + ", " + (b[0] - GAP / 2) + " " + b[1] + ", " + b[0] + " " + b[1];
  }
  const reached = finished ? n - 1 : Math.max(0, pos - 1);
  const cur = pt(Math.min(reached, n - 1));
  const last = steps[n - 1];
  return (
    <div {...aria}>
      <svg className="ob-map" viewBox={"0 0 " + w + " " + H} aria-hidden="true">
        <path d={d} fill="none" stroke="var(--ob-border)" strokeWidth="3" strokeDasharray="1 7" strokeLinecap="round" />
        <motion.path d={d} fill="none" stroke="var(--ob-primary)" strokeWidth="3" strokeLinecap="round" initial={false} animate={{ pathLength: n > 1 ? reached / (n - 1) : 1 }} transition={reduce ? { duration: 0 } : { duration: 0.6 }} />
        {!finished ? <motion.circle r="15" fill="none" stroke="var(--ob-accent)" strokeWidth="2" initial={false} animate={{ cx: cur[0], cy: cur[1] }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 24 }} /> : null}
        {states.map((st, i) => {
          const p = pt(i);
          if (i === n - 1) {
            return (
              <g key={steps[i].id}>
                <circle cx={p[0]} cy={p[1]} r="11" fill={st === "todo" ? "var(--ob-surface)" : "color-mix(in srgb, var(--ob-primary) 18%, var(--ob-surface))"} stroke={st === "todo" ? "var(--ob-border)" : "var(--ob-primary)"} strokeWidth="2" />
                <text x={p[0]} y={p[1] + 0.5} textAnchor="middle" dominantBaseline="central" fontSize="11">{(last && last.emoji) || "🏁"}</text>
              </g>
            );
          }
          const fill = st === "done" ? "var(--ob-primary)" : st === "missed" ? "var(--ob-accent)" : "var(--ob-surface)";
          const stroke = st === "todo" || st === "skipped" ? "var(--ob-border)" : st === "current" ? "var(--ob-accent)" : fill;
          return (
            <g key={steps[i].id}>
              <circle cx={p[0]} cy={p[1]} r={st === "current" ? 8 : 7} fill={fill} stroke={stroke} strokeWidth="2" strokeDasharray={st === "skipped" ? "2 2" : undefined} />
              {st === "done" ? <path d={"M " + (p[0] - 3) + " " + p[1] + " l 2.2 2.2 l 4 -4.4"} fill="none" stroke="var(--ob-on-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
              {st === "current" ? <circle cx={p[0]} cy={p[1]} r="3" fill="var(--ob-accent)" /> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PointsPill({ value, award, floating, tick, reduce }) {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const shown = useTransform(spring, (v) => String(Math.round(v)));
  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);
  return (
    <div style={{ position: "relative" }}>
      <div className="ob-chip" data-testid="flow-points" data-value={value} aria-label={value + " points"}>
        <svg width="0.7em" height="0.7em" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0 L10 5 L5 10 L0 5 Z" fill="var(--ob-primary)" /></svg>
        <motion.b aria-hidden="true">{shown}</motion.b>
        <span className="ob-unit" aria-hidden="true">pts</span>
      </div>
      <AnimatePresence>
        {floating && award > 0 ? (
          <motion.span key={tick} className="ob-float" aria-hidden="true" initial={{ y: 4, opacity: 0 }} animate={{ y: [4, -14, -22], opacity: [0, 1, 0] }} transition={{ duration: 1.1, times: [0, 0.3, 1] }}>
            +{award}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function StreakChip({ value, label, reduce }) {
  const lit = value > 0;
  return (
    <div className="ob-chip ob-streak" data-testid="flow-streak" data-value={value} data-lit={lit} aria-label={"Streak: " + value + " " + label} title={value + " " + label}>
      <motion.span key={value} style={{ display: "inline-flex" }} initial={lit && !reduce ? { scale: 1.6, rotate: -14 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 14 }}>
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill={lit ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={FLAME} /></svg>
      </motion.span>
      <span aria-hidden="true">{value}</span>
    </div>
  );
}

function BadgeToast({ badge, queued, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, queued > 0 ? 1800 : 2600);
    return () => clearTimeout(t);
  }, []);
  return (
    <motion.div className="ob-toast" role="status" data-testid={"flow-badge-" + badge.id} initial={{ opacity: 0, y: -14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.18 } }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
      <motion.span className="ob-toast-emoji" aria-hidden="true" initial={{ rotate: -30, scale: 0.5 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 380, damping: 12, delay: 0.08 }}>{badge.emoji}</motion.span>
      <span className="ob-toast-text"><span>Badge earned: </span><b>{badge.label}</b></span>
    </motion.div>
  );
}

function ruleHint(r) {
  if (r.kind === "steps_completed") return "Finish " + r.count + " steps";
  if (r.kind === "step_completed") return "Complete its step";
  if (r.kind === "points_at_least") return "Reach " + r.points + " pts";
  return r.count + " right answers";
}

function Summary({ spec, flow, visible, onRestart }) {
  const mech = spec.gamification.mechanics;
  const quizTotal = visible.filter((s) => s.type === "quiz_question").length;
  const countable = visible.filter((s) => s.type !== "welcome" && s.type !== "reward").length;
  const stats = [{ label: "Steps done", value: flow.stepsCompleted + "/" + countable }];
  if (quizTotal > 0) stats.push({ label: "Quiz score", value: flow.quizCorrect + "/" + quizTotal });
  if (mech.streak) stats.push({ label: "Best streak", value: String(spec.gamification.style === "quiz_tour" ? flow.bestQuizStreak : flow.bestStreak) });
  return (
    <motion.div className="ob-summary" data-testid="flow-summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div>
        <h2>Here is how you did</h2>
        {mech.points ? <p className="ob-big"><b>{flow.points}</b> points</p> : null}
      </div>
      <dl className="ob-stats">
        {stats.map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
      </dl>
      {mech.badges.length > 0 ? (
        <div>
          <h3>Badges <span className="ob-unit" style={{ fontWeight: 400 }}>{flow.earnedBadgeIds.length} of {mech.badges.length}</span></h3>
          <ul className="ob-blist">
            {mech.badges.map((b) => {
              const got = flow.earnedBadgeIds.includes(b.id);
              return (
                <li key={b.id} data-earned={got}>
                  <span className="ob-bemoji" aria-hidden="true">{b.emoji}</span>
                  <span className="ob-bname">{b.label}</span>
                  <span className="ob-bstate">{got ? "Earned" : ruleHint(b.rule)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <button type="button" className="ob-ghost" data-testid="flow-restart" onClick={onRestart}>Play again</button>
    </motion.div>
  );
}

function nextLabel(step, locked) {
  if (step.type === "welcome") return step.ctaLabel || "Start";
  if (step.type === "email_signup") return step.ctaLabel || "Continue";
  if (step.type === "quiz_question") return locked ? "Continue" : "Check answer";
  if (step.type === "reward") return step.ctaLabel || "Finish";
  return "Continue";
}

export default function OnboardingFlow({ spec = SPEC, onEvent, onLead, initialIndex = 0, reducedMotion }) {
  const osReduce = useReducedMotion();
  const reduce = reducedMotion != null ? reducedMotion : !!osReduce;
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const [ui, setUi] = useState(() => ({ flow: initFlowState(spec, initialIndex), tick: 0, awardTick: -1, revealed: {}, toasts: [] }));
  const flow = ui.flow;
  const step = currentStep(flow);
  const mech = spec.gamification.mechanics;
  const visible = visibleSteps(spec, flow.answers);
  const badgeById = new Map(mech.badges.map((b) => [b.id, b]));
  const emit = (e) => { if (onEvent) onEvent(e); };

  useEffect(() => {
    emit({ type: "step_view", stepId: step.id, index: flow.currentIndex });
  }, [step.id]);

  const answer = flow.answers[step.id];
  const locked = step.type === "quiz_question" && (ui.revealed[step.id] || flow.outcomes[step.id] === "completed");
  const ready = canAdvance(step, answer);

  function act(action) {
    const prev = flow;
    const next = flowReducer(prev, action);
    if (next === prev) return;
    const tick = ui.tick + 1;
    setUi({
      flow: next,
      tick,
      awardTick: next.lastAward > 0 ? tick : ui.awardTick,
      revealed: action.type === "restart" ? {} : ui.revealed,
      toasts: ui.toasts.concat(next.newBadgeIds.map((id) => ({ key: tick + "-" + id, badgeId: id }))),
    });
    const s = currentStep(prev);
    if (action.type === "answer") emit({ type: "answer", stepId: s.id, value: action.value });
    if (action.type === "next") emit({ type: "step_complete", stepId: s.id, pointsAwarded: next.lastAward, totalPoints: next.points });
    if (action.type === "skip") emit({ type: "step_skip", stepId: s.id });
    if (action.type === "back") emit({ type: "back", stepId: s.id });
    if (action.type === "restart") emit({ type: "restart" });
    next.newBadgeIds.forEach((id) => emit({ type: "badge_earned", badgeId: id }));
    if (next.finished && !prev.finished) emit({ type: "finish", points: next.points, badgeIds: next.earnedBadgeIds, answers: next.answers });
  }

  function handleNext(e) {
    if (e) e.preventDefault();
    if (flow.finished || !ready) return;
    if (step.type === "quiz_question" && !locked) {
      setUi(Object.assign({}, ui, { revealed: Object.assign({}, ui.revealed, { [step.id]: true }) }));
      emit({ type: "quiz_checked", stepId: step.id, correct: isQuizCorrect(step, answer) });
      return;
    }
    if (step.type === "email_signup" && typeof answer === "string" && onLead) onLead(answer.trim(), flow.answers);
    act({ type: "next" });
  }

  const dismiss = (key) => setUi((u) => Object.assign({}, u, { toasts: u.toasts.filter((t) => t.key !== key) }));
  const nextIdx = nextVisibleIndex(spec, flow.currentIndex, flow.answers);
  const morphNext = nextIdx !== -1 && spec.steps[nextIdx].transition === "morph";
  const layoutId = step.transition === "morph" || morphNext ? "ob-title" : undefined;
  const item = step.transition === "stagger" && !reduce ? STAGGER_ITEM : undefined;
  const missed = new Set(visible.filter((s) => s.type === "quiz_question" && flow.outcomes[s.id] === "completed" && !isQuizCorrect(s, flow.answers[s.id])).map((s) => s.id));
  const earned = flow.earnedBadgeIds.map((id) => badgeById.get(id)).filter(Boolean);
  const quizStyle = spec.gamification.style === "quiz_tour";
  const hero = step.type === "welcome" || step.type === "reward";
  const toast = ui.toasts[0];
  const toastBadge = toast ? badgeById.get(toast.badgeId) : null;

  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <LayoutGroup id={uid}>
        <style>{THEME_CSS}</style>
        <section className="ob-root" data-testid="flow-root" data-variant={spec.variantKey} data-finished={flow.finished} aria-label={spec.title}>
          <header className="ob-header">
            <div className="ob-topline">
              <p className="ob-flow-title">{spec.title}</p>
              <div className="ob-chips">
                {mech.streak ? <StreakChip value={quizStyle ? flow.quizStreak : flow.streak} label={quizStyle ? "correct answers in a row" : "steps in a row"} reduce={reduce} /> : null}
                {mech.points ? <PointsPill value={flow.points} award={flow.lastAward} floating={ui.awardTick === ui.tick} tick={ui.tick} reduce={reduce} /> : null}
              </div>
            </div>
            <Progress kind={mech.progress} steps={visible} currentId={step.id} finished={flow.finished} outcomes={flow.outcomes} missed={missed} reduce={reduce} />
          </header>

          <AnimatePresence>
            {toast && toastBadge ? <BadgeToast key={toast.key} badge={toastBadge} queued={ui.toasts.length - 1} onDone={() => dismiss(toast.key)} /> : null}
          </AnimatePresence>

          {flow.finished && mech.summaryScreen ? (
            <Summary spec={spec} flow={flow} visible={visible} onRestart={() => act({ type: "restart" })} />
          ) : (
            <form className="ob-form" onSubmit={handleNext} noValidate>
              <div className="ob-stage" data-hero={hero}>
                <AnimatePresence mode="popLayout" custom={flow.direction} initial={!reduce}>
                  <motion.div
                    key={step.id}
                    className="ob-step"
                    data-testid={"flow-step-" + step.id}
                    data-step-type={step.type}
                    data-transition={step.transition}
                    custom={flow.direction}
                    variants={STEP_VARIANTS[step.transition]}
                    initial="enter"
                    animate="center"
                    exit="exit"
                  >
                    <StepHeading step={step} spec={spec} item={item} layoutId={layoutId} reduce={reduce} />
                    <StepBody step={step} answer={answer} onAnswer={(v) => act({ type: "answer", value: v })} revealed={!!locked} item={item} uid={uid} showPoints={mech.points} earned={earned} />
                  </motion.div>
                </AnimatePresence>
              </div>
              <footer className="ob-footer">
                {flow.history.length > 0 && !flow.finished ? (
                  <button type="button" className="ob-back" data-testid="flow-back" aria-label="Back" onClick={() => act({ type: "back" })}><Icon d={ARROW} size="1.05em" /></button>
                ) : null}
                <div className="ob-spacer" />
                {isSkippable(step) && !flow.finished ? (
                  <button type="button" className="ob-skip" data-testid="flow-skip" onClick={() => act({ type: "skip" })}>{step.type === "email_signup" ? "Not now" : "Skip"}</button>
                ) : null}
                {flow.finished ? (
                  <button type="button" className="ob-ghost" data-testid="flow-restart" onClick={() => act({ type: "restart" })}>Start over</button>
                ) : (
                  <motion.button type="submit" className="ob-next" data-testid="flow-next" disabled={!ready} whileTap={ready ? { scale: 0.97 } : undefined}>{nextLabel(step, locked)}</motion.button>
                )}
              </footer>
            </form>
          )}
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}
`;

/** Stylesheet for the exported component: theme variables on .ob-root plus the component rules. */
export function exportThemeCss(spec: FlowSpec, tokens: DesignTokens): string {
  const vars = flowCssVars(spec, tokens);
  const href = googleFontsHref(tokens);
  const head = href ? `@import url("${href}");\n\n` : "";
  const block = `.ob-root {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}\n`;
  return `${head}/* Theme for "${spec.title}" (${spec.variantKey}). Edit the variables to rebrand. */\n${block}\n${COMPONENT_CSS}`;
}

export function exportStandaloneComponent(spec: FlowSpec, tokens: DesignTokens): string {
  const json = JSON.stringify(spec, null, 2);
  return [
    `// OnboardingFlow.jsx: "${spec.title.replace(/[\r\n]/g, " ")}" (${spec.variantKey}).`,
    "// Generated by the onboarding generator. Needs only react and motion.",
    "// Props: onEvent(event), onLead(email, answers), initialIndex, reducedMotion.",
    'import React, { useEffect, useId, useState } from "react";',
    'import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion, useSpring, useTransform } from "motion/react";',
    "",
    `export const SPEC = ${json};`,
    "",
    `const THEME_CSS = ${JSON.stringify(exportThemeCss(spec, tokens))};`,
    "",
    "// Scoring rules: deterministic, no network, no model calls.",
    SCORING_RUNTIME.trim(),
    COMPONENT,
  ].join("\n");
}

export function exportFiles(spec: FlowSpec, tokens: DesignTokens): ExportFile[] {
  return [
    { path: "flow.json", content: `${JSON.stringify(spec, null, 2)}\n` },
    { path: "theme.css", content: exportThemeCss(spec, tokens) },
    { path: "OnboardingFlow.jsx", content: exportStandaloneComponent(spec, tokens) },
  ];
}
