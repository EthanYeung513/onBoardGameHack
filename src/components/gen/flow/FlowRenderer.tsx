"use client";

import { ArrowLeft, Flame, RotateCcw } from "lucide-react";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";
import { useEffect, useId, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import {
  canAdvance,
  currentStep,
  flowReducer,
  initFlowState,
  isQuizCorrect,
  isSkippable,
  nextVisibleIndex,
  visibleSteps,
  type AnswerValue,
  type Answers,
  type FlowAction,
  type FlowState,
} from "@/lib/flow/scoring";
import type { Badge, FlowSpec, Step } from "@/lib/flow/spec";
import { flowCssVars, googleFontsHref } from "@/lib/flow/theme";
import type { DesignTokens } from "@/lib/schemas/tokens";
import { FlowStepBody } from "./FlowStepBody";
import { PathMap, ProgressBar } from "./FlowProgress";
import { morphLayout, staggerItem, stepVariants, tint } from "./style";

export type FlowEvent =
  | { type: "step_view"; stepId: string; index: number }
  | { type: "answer"; stepId: string; value: AnswerValue }
  | { type: "quiz_checked"; stepId: string; correct: boolean }
  | { type: "step_complete"; stepId: string; pointsAwarded: number; totalPoints: number }
  | { type: "step_skip"; stepId: string }
  | { type: "back"; stepId: string }
  | { type: "badge_earned"; badgeId: string }
  | { type: "finish"; points: number; badgeIds: string[]; answers: Answers }
  | { type: "restart" };

export interface FlowRendererProps {
  spec: FlowSpec;
  tokens: DesignTokens;
  onEvent?: (e: FlowEvent) => void;
  onLead?: (email: string, answers: Answers) => void;
  /** Start on this step index (for screenshots and previews). */
  initialIndex?: number;
  /** Force reduced motion on or off. Defaults to the user's OS setting. */
  reducedMotion?: boolean;
  className?: string;
}

interface Toast {
  key: string;
  badgeId: string;
}

interface UiState {
  flow: FlowState;
  tick: number;
  /** Tick of the last action that awarded points; drives the +N float. */
  awardTick: number;
  revealed: Record<string, boolean>;
  toasts: Toast[];
}

export function FlowRenderer({ spec, tokens, onEvent, onLead, initialIndex, reducedMotion, className }: FlowRendererProps) {
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const osReduce = useReducedMotion();
  const reduce = reducedMotion ?? osReduce ?? false;
  const [ui, setUi] = useState<UiState>(() => ({
    flow: initFlowState(spec, initialIndex),
    tick: 0,
    awardTick: -1,
    revealed: {},
    toasts: [],
  }));
  const { flow } = ui;
  const step = currentStep(flow);
  const mech = spec.gamification.mechanics;
  const visible = useMemo(() => visibleSteps(spec, flow.answers), [spec, flow.answers]);
  const vars = useMemo(() => flowCssVars(spec, tokens), [spec, tokens]);
  const fontHref = googleFontsHref(tokens);
  const badgeById = useMemo(() => new Map(mech.badges.map((b) => [b.id, b])), [mech.badges]);

  useEffect(() => {
    onEvent?.({ type: "step_view", stepId: step.id, index: flow.currentIndex });
    // Only on step change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const answer = flow.answers[step.id];
  const quizLocked = step.type === "quiz_question" && (ui.revealed[step.id] || flow.outcomes[step.id] === "completed");
  const ready = canAdvance(step, answer);

  function act(action: FlowAction) {
    const prev = flow;
    const next = flowReducer(prev, action);
    if (next === prev) return;
    const tick = ui.tick + 1;
    const toasts = [...ui.toasts, ...next.newBadgeIds.map((id) => ({ key: `${tick}-${id}`, badgeId: id }))];
    setUi({
      ...ui,
      flow: next,
      tick,
      awardTick: next.lastAward > 0 ? tick : ui.awardTick,
      toasts,
      revealed: action.type === "restart" ? {} : ui.revealed,
    });
    if (!onEvent) return;
    const s = currentStep(prev);
    if (action.type === "answer") onEvent({ type: "answer", stepId: s.id, value: action.value });
    if (action.type === "next" && next !== prev)
      onEvent({ type: "step_complete", stepId: s.id, pointsAwarded: next.lastAward, totalPoints: next.points });
    if (action.type === "skip" && next !== prev) onEvent({ type: "step_skip", stepId: s.id });
    if (action.type === "back" && next !== prev) onEvent({ type: "back", stepId: s.id });
    if (action.type === "restart") onEvent({ type: "restart" });
    for (const id of next.newBadgeIds) onEvent({ type: "badge_earned", badgeId: id });
    if (next.finished && !prev.finished)
      onEvent({ type: "finish", points: next.points, badgeIds: next.earnedBadgeIds, answers: next.answers });
  }

  function handleNext(e?: FormEvent) {
    e?.preventDefault();
    if (flow.finished || !ready) return;
    if (step.type === "quiz_question" && !quizLocked) {
      setUi({ ...ui, revealed: { ...ui.revealed, [step.id]: true } });
      onEvent?.({ type: "quiz_checked", stepId: step.id, correct: isQuizCorrect(step, answer) });
      return;
    }
    if (step.type === "email_signup" && typeof answer === "string") onLead?.(answer.trim(), flow.answers);
    act({ type: "next" });
  }

  const dismiss = (key: string) => setUi((u) => ({ ...u, toasts: u.toasts.filter((t) => t.key !== key) }));

  const nextIdx = nextVisibleIndex(spec, flow.currentIndex, flow.answers);
  const nextIsMorph = nextIdx !== -1 && spec.steps[nextIdx].transition === "morph";
  const titleLayoutId = step.transition === "morph" || nextIsMorph ? "ob-title" : undefined;
  const item: Variants | undefined = step.transition === "stagger" && !reduce ? staggerItem : undefined;
  const missed = new Set(
    visible.filter((s) => s.type === "quiz_question" && flow.outcomes[s.id] === "completed" && !isQuizCorrect(s, flow.answers[s.id])).map((s) => s.id),
  );
  const earnedBadges = flow.earnedBadgeIds.map((id) => badgeById.get(id)).filter((b): b is Badge => !!b);
  const streakValue = spec.gamification.style === "quiz_tour" ? flow.quizStreak : flow.streak;
  const streakLabel = spec.gamification.style === "quiz_tour" ? "correct answers in a row" : "steps in a row";
  const showSummary = flow.finished && mech.summaryScreen;
  const isFirst = flow.history.length === 0;

  const progressProps = { steps: visible, currentId: step.id, finished: flow.finished, outcomes: flow.outcomes, missed, reduce };

  const rootStyle = {
    ...vars,
    fontFamily: "var(--ob-font-body)",
    fontSize: "var(--ob-font-size)",
    lineHeight: 1.5,
    color: "var(--ob-text)",
    background: "var(--ob-surface)",
    borderColor: "var(--ob-border)",
    borderRadius: "var(--ob-radius-lg)",
    boxShadow: "var(--ob-shadow)",
  } as CSSProperties;

  return (
    <MotionConfig reducedMotion={reduce ? "always" : "never"}>
      <LayoutGroup id={uid}>
        {fontHref && <link rel="stylesheet" href={fontHref} precedence="default" />}
        <section
          data-testid="flow-root"
          data-variant={spec.variantKey}
          data-finished={flow.finished}
          aria-label={spec.title}
          className={`relative isolate flex w-full flex-col overflow-hidden border ${className ?? ""}`}
          style={rootStyle}
        >
          <header className="grid gap-[0.875em] px-[1.25em] pb-[0.25em] pt-[1.1em]">
            <div className="flex items-center justify-between gap-[0.75em]">
              <p
                className="m-0 min-w-0 truncate text-[0.9375em]"
                style={{ fontFamily: "var(--ob-font-heading)", fontWeight: "var(--ob-heading-weight)" as CSSProperties["fontWeight"] }}
              >
                {spec.title}
              </p>
              <div className="flex shrink-0 items-center gap-[0.4em]">
                {mech.streak && <StreakChip value={streakValue} label={streakLabel} reduce={reduce} />}
                {mech.points && <PointsPill value={flow.points} award={flow.lastAward} awardTick={ui.awardTick} tick={ui.tick} reduce={reduce} />}
              </div>
            </div>
            {mech.progress === "path_map" ? <PathMap {...progressProps} /> : <ProgressBar {...progressProps} />}
          </header>

          <AnimatePresence>
            {ui.toasts.slice(0, 1).map((t) => {
              const b = badgeById.get(t.badgeId);
              return b ? <BadgeToast key={t.key} badge={b} queued={ui.toasts.length - 1} onDone={() => dismiss(t.key)} /> : null;
            })}
          </AnimatePresence>

          {showSummary ? (
            <FlowSummary spec={spec} flow={flow} visible={visible} earned={earnedBadges} onRestart={() => act({ type: "restart" })} />
          ) : (
            <form onSubmit={handleNext} noValidate className="flex flex-1 flex-col">
              <div
                className={`relative flex flex-1 flex-col px-[1.25em] pb-[1.25em] pt-[1em] ${step.type === "welcome" || step.type === "reward" ? "justify-center" : ""}`}
              >
                <AnimatePresence mode="popLayout" custom={flow.direction} initial={!reduce}>
                  <motion.div
                    key={step.id}
                    data-testid={`flow-step-${step.id}`}
                    data-step-type={step.type}
                    data-transition={step.transition}
                    custom={flow.direction}
                    variants={stepVariants[step.transition]}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    className="grid gap-[1.1em]"
                  >
                    <StepHeading step={step} spec={spec} item={item} layoutId={titleLayoutId} reduce={reduce} />
                    <FlowStepBody
                      step={step}
                      answer={answer}
                      onAnswer={(v) => act({ type: "answer", value: v })}
                      revealed={!!quizLocked}
                      item={item}
                      uid={uid}
                      showPoints={mech.points}
                      reduce={reduce}
                      earnedBadges={earnedBadges}
                      points={flow.points}
                    />
                  </motion.div>
                </AnimatePresence>
              </div>

              <footer
                className="flex items-center gap-[0.5em] border-t px-[1.25em] py-[0.875em]"
                style={{ borderColor: tint("muted", 14, "var(--ob-surface)"), background: tint("muted", 3) }}
              >
                {!isFirst && !flow.finished && (
                  <button
                    type="button"
                    data-testid="flow-back"
                    onClick={() => act({ type: "back" })}
                    className="inline-flex size-[2.6em] items-center justify-center border transition-colors hover:[background:color-mix(in_srgb,var(--ob-muted)_10%,var(--ob-surface))] focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ borderRadius: "var(--ob-radius-md)", borderColor: "var(--ob-border)", outlineColor: "var(--ob-primary)" }}
                    aria-label="Back"
                  >
                    <ArrowLeft size="1.05em" />
                  </button>
                )}
                <div className="flex-1" />
                {isSkippable(step) && !flow.finished && (
                  <button
                    type="button"
                    data-testid="flow-skip"
                    onClick={() => act({ type: "skip" })}
                    className="px-[0.75em] py-[0.6em] text-[0.9375em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: "var(--ob-muted)", borderRadius: "var(--ob-radius-sm)", outlineColor: "var(--ob-primary)" }}
                  >
                    {step.type === "email_signup" ? "Not now" : "Skip"}
                  </button>
                )}
                {flow.finished ? (
                  <button
                    type="button"
                    data-testid="flow-restart"
                    onClick={() => act({ type: "restart" })}
                    className="inline-flex items-center gap-[0.5em] px-[1.1em] py-[0.65em] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ borderRadius: "var(--ob-radius-md)", background: tint("primary", 12), color: "var(--ob-text)", outlineColor: "var(--ob-primary)" }}
                  >
                    <RotateCcw size="1em" /> Start over
                  </button>
                ) : (
                  <motion.button
                    type="submit"
                    data-testid="flow-next"
                    disabled={!ready}
                    whileTap={ready ? { scale: 0.97 } : undefined}
                    className="inline-flex min-w-[8.5em] items-center justify-center px-[1.25em] py-[0.7em] font-semibold transition-[opacity,filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{
                      borderRadius: "var(--ob-radius-md)",
                      background: "var(--ob-primary)",
                      color: "var(--ob-on-primary)",
                      outlineColor: "var(--ob-primary)",
                    }}
                  >
                    {nextLabel(step, !!quizLocked)}
                  </motion.button>
                )}
              </footer>
            </form>
          )}
        </section>
      </LayoutGroup>
    </MotionConfig>
  );
}

function nextLabel(step: Step, quizLocked: boolean): string {
  switch (step.type) {
    case "welcome":
      return step.ctaLabel ?? "Start";
    case "email_signup":
      return step.ctaLabel ?? "Continue";
    case "quiz_question":
      return quizLocked ? "Continue" : "Check answer";
    case "reward":
      return step.ctaLabel ?? "Finish";
    default:
      return "Continue";
  }
}

function StepHeading({
  step,
  spec,
  item,
  layoutId,
  reduce,
}: {
  step: Step;
  spec: FlowSpec;
  item?: Variants;
  layoutId?: string;
  reduce: boolean;
}) {
  const hero = step.type === "welcome" || step.type === "reward";
  const emoji = hero ? step.emoji : undefined;
  const body = step.body ?? (step.type === "welcome" ? spec.tagline : undefined);
  return (
    <div className={hero ? "grid justify-items-center gap-[0.6em] pt-[0.75em] text-center" : "grid gap-[0.45em]"}>
      {hero && (
        <div className="relative">
          {step.type === "reward" && !reduce && <Burst />}
          <motion.div
            variants={item}
            initial={step.type === "reward" && !reduce ? { scale: 0.3, rotate: -12, opacity: 0 } : false}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.1 }}
            aria-hidden
            className="relative grid size-[2.1em] place-items-center text-[2.2em]"
            style={{
              borderRadius: "var(--ob-radius-lg)",
              background: step.type === "reward" ? "var(--ob-primary)" : tint("primary", 12),
              boxShadow: step.type === "reward" ? `0 0 0 6px ${tint("primary", 16)}` : "none",
            }}
          >
            <span className="text-[1em]">{emoji ?? (step.type === "reward" ? "🏆" : "👋")}</span>
          </motion.div>
        </div>
      )}
      <motion.h2
        layoutId={layoutId}
        layout={layoutId ? "position" : undefined}
        transition={{ layout: morphLayout }}
        variants={item}
        className="m-0 text-balance"
        style={{
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          fontFamily: "var(--ob-font-heading)",
          fontWeight: "var(--ob-heading-weight)" as CSSProperties["fontWeight"],
          fontSize: hero ? "1.85em" : "1.45em",
        }}
      >
        {step.title}
      </motion.h2>
      {body && (
        <motion.p
          variants={item}
          className={`m-0 text-pretty leading-relaxed ${hero ? "max-w-[30ch]" : "max-w-[46ch]"}`}
          style={{ color: "var(--ob-muted)" }}
        >
          {body}
        </motion.p>
      )}
    </div>
  );
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
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2">
      {BURST.map((b, i) => (
        <motion.span
          key={i}
          className="absolute block"
          style={{ width: b.round ? 8 : 6, height: b.round ? 8 : 13, marginLeft: -3, marginTop: -6, borderRadius: b.round ? 99 : 2, background: b.color }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
          animate={{ x: b.x, y: [0, b.y, b.y + 40, b.y + 70], opacity: [0, 1, 1, 0], rotate: b.rot * 2, scale: 1 }}
          transition={{ duration: 1.6, delay: 0.12 + (i % 6) * 0.025, ease: [0.16, 1, 0.3, 1], times: [0, 0.35, 0.8, 1] }}
        />
      ))}
    </div>
  );
}

function PointsPill({ value, award, awardTick, tick, reduce }: { value: number; award: number; awardTick: number; tick: number; reduce: boolean }) {
  const spring = useSpring(value, { stiffness: 140, damping: 22 });
  const shown = useTransform(spring, (v) => Math.round(v).toString());
  useEffect(() => {
    if (reduce) spring.jump(value);
    else spring.set(value);
  }, [value, reduce, spring]);
  const floating = awardTick === tick && award > 0;
  return (
    <div className="relative">
      <div
        data-testid="flow-points"
        data-value={value}
        aria-label={`${value} points`}
        className="inline-flex items-baseline gap-[0.3em] py-[0.3em] pl-[0.55em] pr-[0.7em] text-[0.875em]"
        style={{ borderRadius: 999, background: tint("primary", 12) }}
      >
        <svg aria-hidden width="0.7em" height="0.7em" viewBox="0 0 10 10" className="self-center">
          <path d="M5 0 L10 5 L5 10 L0 5 Z" fill="var(--ob-primary)" />
        </svg>
        <motion.span className="font-semibold tabular-nums" aria-hidden>
          {shown}
        </motion.span>
        <span aria-hidden style={{ color: "var(--ob-muted)" }}>
          pts
        </span>
      </div>
      <AnimatePresence>
        {floating && (
          <motion.span
            key={awardTick}
            aria-hidden
            className="pointer-events-none absolute right-[0.6em] top-0 text-[0.8125em] font-bold tabular-nums"
            style={{ color: "var(--ob-primary)" }}
            initial={{ y: 4, opacity: 0 }}
            animate={{ y: [4, -14, -22], opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, times: [0, 0.3, 1], ease: "easeOut" }}
          >
            +{award}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function StreakChip({ value, label, reduce }: { value: number; label: string; reduce: boolean }) {
  const lit = value > 0;
  return (
    <div
      data-testid="flow-streak"
      data-value={value}
      aria-label={`Streak: ${value} ${label}`}
      title={`${value} ${label}`}
      className="inline-flex items-center gap-[0.25em] py-[0.3em] pl-[0.45em] pr-[0.65em] text-[0.875em] font-semibold tabular-nums transition-colors"
      style={{
        borderRadius: 999,
        background: lit ? tint("accent", 14) : tint("muted", 8),
        color: lit ? "var(--ob-accent)" : "var(--ob-muted)",
      }}
    >
      <motion.span
        key={value}
        className="inline-flex"
        initial={lit && !reduce ? { scale: 1.6, rotate: -14 } : false}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 14 }}
      >
        <Flame size="1em" fill={lit ? "currentColor" : "none"} />
      </motion.span>
      <span aria-hidden>{value}</span>
    </div>
  );
}

/** One toast at a time, pinned over the title row so it never covers the step content. */
function BadgeToast({ badge, queued, onDone }: { badge: Badge; queued: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, queued > 0 ? 1800 : 2600);
    return () => clearTimeout(t);
    // The timer belongs to this toast instance only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <motion.div
      role="status"
      data-testid={`flow-badge-${badge.id}`}
      initial={{ opacity: 0, y: -14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      className="absolute left-[0.75em] top-[0.55em] z-20 flex max-w-[calc(100%-1.5em)] items-center gap-[0.6em] py-[0.35em] pl-[0.35em] pr-[0.9em]"
      style={{
        borderRadius: "var(--ob-radius-md)",
        background: "var(--ob-text)",
        color: "var(--ob-surface)",
        boxShadow: "0 12px 30px -12px rgba(0,0,0,0.45)",
      }}
    >
      <motion.span
        aria-hidden
        className="grid size-[1.9em] shrink-0 place-items-center text-[1.05em]"
        style={{ borderRadius: "var(--ob-radius-sm)", background: "var(--ob-surface)", boxShadow: "inset 0 0 0 2px var(--ob-accent)" }}
        initial={{ rotate: -30, scale: 0.5 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 12, delay: 0.08 }}
      >
        {badge.emoji}
      </motion.span>
      <span className="min-w-0 truncate text-[0.9375em] leading-tight">
        <span className="opacity-70">Badge earned: </span>
        <span className="font-semibold">{badge.label}</span>
      </span>
    </motion.div>
  );
}

function FlowSummary({
  spec,
  flow,
  visible,
  earned,
  onRestart,
}: {
  spec: FlowSpec;
  flow: FlowState;
  visible: Step[];
  earned: Badge[];
  onRestart: () => void;
}) {
  const mech = spec.gamification.mechanics;
  const quizTotal = visible.filter((s) => s.type === "quiz_question").length;
  const countable = visible.filter((s) => s.type !== "welcome" && s.type !== "reward").length;
  const stats: { label: string; value: string }[] = [{ label: "Steps done", value: `${flow.stepsCompleted}/${countable}` }];
  if (quizTotal > 0) stats.push({ label: "Quiz score", value: `${flow.quizCorrect}/${quizTotal}` });
  if (mech.streak) stats.push({ label: "Best streak", value: String(spec.gamification.style === "quiz_tour" ? flow.bestQuizStreak : flow.bestStreak) });

  return (
    <motion.div
      data-testid="flow-summary"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="grid gap-[1.25em] px-[1.25em] pb-[1.25em] pt-[1.25em]"
    >
      <div className="grid gap-[0.2em]">
        <h2
          className="m-0"
          style={{ lineHeight: 1.15, letterSpacing: "-0.01em", fontFamily: "var(--ob-font-heading)", fontWeight: "var(--ob-heading-weight)" as CSSProperties["fontWeight"], fontSize: "1.45em" }}
        >
          Here is how you did
        </h2>
        {mech.points && (
          <p className="m-0 flex items-baseline gap-[0.35em]" style={{ color: "var(--ob-muted)" }}>
            <span className="text-[2.6em] font-semibold leading-none tabular-nums" style={{ color: "var(--ob-primary)" }}>
              {flow.points}
            </span>
            points
          </p>
        )}
      </div>

      <dl
        className="m-0 grid grid-cols-[repeat(auto-fit,minmax(6.5em,1fr))] gap-px overflow-hidden"
        style={{ borderRadius: "var(--ob-radius-md)", background: "var(--ob-border)", border: "1px solid var(--ob-border)" }}
      >
        {stats.map((s) => (
          <div key={s.label} className="grid gap-[0.15em] px-[0.875em] py-[0.7em]" style={{ background: "var(--ob-surface)" }}>
            <dt className="text-[0.75em]" style={{ color: "var(--ob-muted)" }}>
              {s.label}
            </dt>
            <dd className="m-0 text-[1.15em] font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {mech.badges.length > 0 && (
        <div className="grid gap-[0.5em]">
          <h3 className="m-0 text-[0.875em] font-semibold" style={{ fontFamily: "inherit", letterSpacing: "normal", lineHeight: 1.4 }}>
            Badges <span style={{ color: "var(--ob-muted)", fontWeight: 400 }}>{earned.length} of {mech.badges.length}</span>
          </h3>
          <ul className="m-0 grid list-none gap-[0.4em] p-0">
            {mech.badges.map((b, i) => {
              const got = flow.earnedBadgeIds.includes(b.id);
              return (
                <motion.li
                  key={b.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.07 }}
                  className="flex items-center gap-[0.7em] px-[0.6em] py-[0.5em]"
                  style={{ borderRadius: "var(--ob-radius-md)", background: got ? tint("primary", 9) : "transparent", border: `1px ${got ? "solid" : "dashed"} ${got ? "transparent" : "var(--ob-border)"}` }}
                >
                  <span
                    aria-hidden
                    className="grid size-[2em] place-items-center text-[1.05em]"
                    style={{ borderRadius: "var(--ob-radius-sm)", background: got ? "var(--ob-surface)" : tint("muted", 8), filter: got ? "none" : "grayscale(1)", opacity: got ? 1 : 0.55 }}
                  >
                    {b.emoji}
                  </span>
                  <span className="flex-1 font-medium" style={{ color: got ? "var(--ob-text)" : "var(--ob-muted)" }}>
                    {b.label}
                  </span>
                  <span className="text-[0.8125em]" style={{ color: got ? "var(--ob-primary)" : "var(--ob-muted)" }}>
                    {got ? "Earned" : ruleHint(b)}
                  </span>
                </motion.li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        data-testid="flow-restart"
        onClick={onRestart}
        className="inline-flex items-center justify-center gap-[0.5em] justify-self-start px-[1.1em] py-[0.65em] font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ borderRadius: "var(--ob-radius-md)", border: "1px solid var(--ob-border)", outlineColor: "var(--ob-primary)" }}
      >
        <RotateCcw size="1em" /> Play again
      </button>
    </motion.div>
  );
}

function ruleHint(b: Badge): string {
  const r = b.rule;
  switch (r.kind) {
    case "steps_completed":
      return `Finish ${r.count} steps`;
    case "step_completed":
      return "Complete its step";
    case "points_at_least":
      return `Reach ${r.points} pts`;
    case "quiz_correct":
      return `${r.count} right answers`;
  }
}
