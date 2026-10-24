"use client";

import { Check, X } from "lucide-react";
import { motion, type Variants } from "motion/react";
import type { AnswerValue } from "@/lib/flow/scoring";
import { BASE_POINTS, isQuizCorrect } from "@/lib/flow/scoring";
import type { Badge, Option, Step, StepOf } from "@/lib/flow/spec";
import { tint } from "./style";

interface BodyProps {
  step: Step;
  answer: AnswerValue | undefined;
  onAnswer: (v: AnswerValue) => void;
  /** Quiz answer has been checked; options lock and show right/wrong. */
  revealed: boolean;
  item?: Variants;
  uid: string;
  showPoints: boolean;
  reduce: boolean;
  earnedBadges: Badge[];
  points: number;
}

const asList = (v: AnswerValue | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" ? [v] : []);

export function FlowStepBody(props: BodyProps) {
  const { step } = props;
  switch (step.type) {
    case "welcome":
      return null;
    case "single_choice":
      return <ChoiceList {...props} options={step.options} multi={false} />;
    case "multiple_choice":
      return <ChoiceList {...props} options={step.options} multi max={step.maxSelect} />;
    case "quiz_question":
      return <QuizBody {...props} step={step} />;
    case "text_input":
      return <TextBody {...props} step={step} />;
    case "email_signup":
      return <EmailBody {...props} step={step} />;
    case "feature_tour":
      return <TourBody {...props} step={step} />;
    case "checklist":
      return <ChecklistBody {...props} step={step} />;
    case "reward":
      return <RewardBody {...props} />;
  }
}

/** "answer" marks a correct option the user did not pick. */
type MarkState = "off" | "on" | "correct" | "wrong" | "answer";

function Mark({ shape, state }: { shape: "radio" | "box"; state: MarkState }) {
  if (state === "answer") {
    return (
      <span
        aria-hidden
        className="grid size-[1.375em] shrink-0 place-items-center border-[1.5px] border-dashed"
        style={{ borderRadius: shape === "radio" ? 999 : "calc(var(--ob-radius-sm) + 1px)", borderColor: "var(--ob-primary)", color: "var(--ob-primary)" }}
      >
        <Check size="0.85em" strokeWidth={3} />
      </span>
    );
  }
  const filled = state !== "off";
  const bg = state === "wrong" ? "var(--ob-accent)" : "var(--ob-primary)";
  const fg = state === "wrong" ? "var(--ob-on-accent)" : "var(--ob-on-primary)";
  return (
    <span
      aria-hidden
      className="relative grid size-[1.375em] shrink-0 place-items-center border-[1.5px] transition-colors"
      style={{
        borderRadius: shape === "radio" ? 999 : "calc(var(--ob-radius-sm) + 1px)",
        borderColor: filled ? bg : tint("muted", 45, "var(--ob-border)"),
        background: filled ? bg : "transparent",
        color: fg,
      }}
    >
      {filled && (
        <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 600, damping: 24 }}>
          {state === "wrong" ? <X size="0.85em" strokeWidth={3} /> : shape === "radio" && state === "on" ? (
            <span className="block size-[0.45em] rounded-full" style={{ background: fg }} />
          ) : (
            <Check size="0.85em" strokeWidth={3} />
          )}
        </motion.span>
      )}
    </span>
  );
}

function OptionTile({
  option,
  name,
  multi,
  checked,
  disabled,
  state,
  dim,
  onToggle,
  item,
}: {
  option: Option;
  name: string;
  multi: boolean;
  checked: boolean;
  disabled: boolean;
  state: MarkState;
  dim: boolean;
  onToggle: () => void;
  item?: Variants;
}) {
  const strong = state === "wrong" ? "accent" : state === "off" ? null : "primary";
  const missedAnswer = state === "answer";
  return (
    <motion.label
      variants={item}
      data-testid={`flow-option-${option.id}`}
      data-state={state}
      className="group flex cursor-pointer items-center gap-[0.75em] border px-[0.875em] py-[0.7em] transition-[border-color,background-color,opacity] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:disabled]:cursor-default"
      style={{
        borderRadius: "var(--ob-radius-md)",
        borderColor: strong ? `var(--ob-${strong})` : "var(--ob-border)",
        borderStyle: missedAnswer ? "dashed" : "solid",
        background: strong && !missedAnswer ? tint(strong, 9) : "var(--ob-surface)",
        boxShadow: strong && !missedAnswer ? `inset 3px 0 0 var(--ob-${strong})` : "none",
        outlineColor: "var(--ob-primary)",
        opacity: dim ? 0.5 : 1,
      }}
    >
      <input
        type={multi ? "checkbox" : "radio"}
        name={name}
        value={option.id}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="sr-only"
      />
      {option.emoji && (
        <span
          aria-hidden
          className="grid size-[2.25em] shrink-0 place-items-center text-[1.1em]"
          style={{ borderRadius: "var(--ob-radius-sm)", background: tint(strong ?? "muted", strong ? 16 : 8) }}
        >
          {option.emoji}
        </span>
      )}
      <span className="min-w-0 flex-1 leading-snug">{option.label}</span>
      <Mark shape={multi ? "box" : "radio"} state={state} />
    </motion.label>
  );
}

function ChoiceList({
  step,
  options,
  multi,
  max,
  answer,
  onAnswer,
  item,
  uid,
}: BodyProps & { options: Option[]; multi: boolean; max?: number }) {
  const picked = asList(answer);
  const toggle = (id: string) => {
    if (!multi) return onAnswer(id);
    if (picked.includes(id)) return onAnswer(picked.filter((p) => p !== id));
    if (max && picked.length >= max) return onAnswer([...picked.slice(1), id]);
    onAnswer([...picked, id]);
  };
  return (
    <fieldset className="m-0 grid gap-[0.5em] border-0 p-0">
      <legend className="sr-only">{step.title}</legend>
      {options.map((o) => (
        <OptionTile
          key={o.id}
          option={o}
          name={`${uid}-${step.id}`}
          multi={multi}
          checked={picked.includes(o.id)}
          disabled={false}
          state={picked.includes(o.id) ? "on" : "off"}
          dim={false}
          onToggle={() => toggle(o.id)}
          item={item}
        />
      ))}
    </fieldset>
  );
}

function QuizBody(props: BodyProps & { step: StepOf<"quiz_question"> }) {
  const { step, answer, onAnswer, revealed, item, uid, reduce } = props;
  const picked = asList(answer);
  const multi = step.correctOptionIds.length > 1;
  const correct = isQuizCorrect(step, answer);
  const toggle = (id: string) => {
    if (revealed) return;
    if (!multi) return onAnswer([id]);
    onAnswer(picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id]);
  };
  return (
    <div className="grid gap-[0.875em]">
      <fieldset className="m-0 grid gap-[0.5em] border-0 p-0">
        <legend className="sr-only">{step.title}</legend>
        {step.options.map((o) => {
          const isPicked = picked.includes(o.id);
          const isRight = step.correctOptionIds.includes(o.id);
          const state: MarkState = revealed
            ? isRight
              ? isPicked
                ? "correct"
                : "answer"
              : isPicked
                ? "wrong"
                : "off"
            : isPicked
              ? "on"
              : "off";
          return (
            <OptionTile
              key={o.id}
              option={o}
              name={`${uid}-${step.id}`}
              multi={multi}
              checked={isPicked}
              disabled={revealed}
              state={state}
              dim={revealed && !isRight && !isPicked}
              onToggle={() => toggle(o.id)}
              item={item}
            />
          );
        })}
      </fieldset>
      {revealed && (
        <motion.div
          role="status"
          data-testid="flow-quiz-feedback"
          data-correct={correct}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-[0.75em] px-[0.875em] py-[0.75em]"
          style={{
            borderRadius: "var(--ob-radius-md)",
            background: tint(correct ? "primary" : "accent", 10),
          }}
        >
          <span
            aria-hidden
            className="mt-[0.1em] grid size-[1.5em] shrink-0 place-items-center rounded-full"
            style={{ background: correct ? "var(--ob-primary)" : "var(--ob-accent)", color: correct ? "var(--ob-on-primary)" : "var(--ob-on-accent)" }}
          >
            {correct ? <Check size="0.9em" strokeWidth={3} /> : <X size="0.9em" strokeWidth={3} />}
          </span>
          <p className="m-0 text-[0.9375em] leading-relaxed">
            <strong className="font-semibold">{correct ? "Correct." : "Not quite."}</strong> {step.explanation}
          </p>
        </motion.div>
      )}
    </div>
  );
}

const fieldClass =
  "w-full border bg-transparent [border-color:var(--ob-border)] px-[0.875em] py-[0.7em] text-[1em] outline-none transition-[border-color,box-shadow] duration-150 placeholder:opacity-60 focus:[border-color:var(--ob-primary)] focus:[box-shadow:0_0_0_3px_color-mix(in_srgb,var(--ob-primary)_22%,transparent)]";
// outline is off because the focus ring is drawn with box-shadow in the brand colour.
const fieldStyle = { borderRadius: "var(--ob-radius-md)", color: "var(--ob-text)", outline: "none" } as const;

function TextBody({ step, answer, onAnswer, uid, item }: BodyProps & { step: StepOf<"text_input"> }) {
  const value = typeof answer === "string" ? answer : "";
  const id = `${uid}-${step.id}-input`;
  return (
    <motion.div variants={item} className="grid gap-[0.4em]">
      <label htmlFor={id} className="text-[0.875em] font-medium">
        {step.inputLabel}
        {step.optional && <span style={{ color: "var(--ob-muted)" }}> (optional)</span>}
      </label>
      {step.multiline ? (
        <textarea
          id={id}
          data-testid="flow-input"
          rows={3}
          value={value}
          maxLength={step.maxLength}
          placeholder={step.placeholder}
          onChange={(e) => onAnswer(e.target.value)}
          className={`${fieldClass} resize-y`}
          style={fieldStyle}
        />
      ) : (
        <input
          id={id}
          data-testid="flow-input"
          type="text"
          autoComplete="off"
          value={value}
          maxLength={step.maxLength}
          placeholder={step.placeholder}
          onChange={(e) => onAnswer(e.target.value)}
          className={fieldClass}
          style={fieldStyle}
        />
      )}
      {step.maxLength && (
        <span className="justify-self-end text-[0.75em] tabular-nums" style={{ color: "var(--ob-muted)" }}>
          {value.length}/{step.maxLength}
        </span>
      )}
    </motion.div>
  );
}

function EmailBody({ step, answer, onAnswer, uid, item }: BodyProps & { step: StepOf<"email_signup"> }) {
  const value = typeof answer === "string" ? answer : "";
  const id = `${uid}-${step.id}-email`;
  return (
    <motion.div variants={item} className="grid gap-[0.4em]">
      <label htmlFor={id} className="text-[0.875em] font-medium">
        {step.inputLabel ?? "Email address"}
      </label>
      <input
        id={id}
        data-testid="flow-input"
        type="email"
        inputMode="email"
        autoComplete="email"
        value={value}
        placeholder={step.placeholder ?? "you@example.com"}
        onChange={(e) => onAnswer(e.target.value)}
        className={fieldClass}
        style={fieldStyle}
      />
      {step.consentText && (
        <p className="m-0 text-[0.8125em] leading-relaxed" style={{ color: "var(--ob-muted)" }}>
          {step.consentText}
        </p>
      )}
    </motion.div>
  );
}

function TourBody({ step, item }: BodyProps & { step: StepOf<"feature_tour"> }) {
  return (
    <ol className="m-0 grid list-none gap-[0.5em] p-0">
      {step.cards.map((c, i) => (
        <motion.li
          key={i}
          variants={item}
          className="overflow-hidden border"
          style={{ borderRadius: "var(--ob-radius-md)", borderColor: "var(--ob-border)", background: "var(--ob-surface)" }}
        >
          {c.imageUrl && (
            <div
              role="img"
              aria-label={c.title}
              className="aspect-[16/7] w-full bg-cover bg-center"
              style={{ backgroundImage: `url(${JSON.stringify(c.imageUrl)})`, backgroundColor: tint("primary", 10) }}
            />
          )}
          <div className="flex gap-[0.75em] px-[0.875em] py-[0.75em]">
            <span
              aria-hidden
              className="grid size-[2.25em] shrink-0 place-items-center text-[1.1em]"
              style={{ borderRadius: "var(--ob-radius-sm)", background: tint("primary", 12) }}
            >
              {c.emoji ?? "•"}
            </span>
            <div className="min-w-0">
              <h3 className="m-0 text-[1em] font-semibold" style={{ fontFamily: "inherit", letterSpacing: "normal", lineHeight: 1.35 }}>
                {c.title}
              </h3>
              <p className="m-0 mt-[0.2em] text-[0.9375em] leading-relaxed" style={{ color: "var(--ob-muted)" }}>
                {c.body}
              </p>
            </div>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

function ChecklistBody({ step, answer, onAnswer, item, showPoints }: BodyProps & { step: StepOf<"checklist"> }) {
  const picked = asList(answer);
  const per = step.points ?? BASE_POINTS.checklist;
  return (
    <fieldset className="m-0 grid gap-[0.375em] border-0 p-0">
      <legend className="sr-only">{step.title}</legend>
      {step.items.map((it) => {
        const on = picked.includes(it.id);
        return (
          <motion.label
            key={it.id}
            variants={item}
            data-testid={`flow-option-${it.id}`}
            data-state={on ? "on" : "off"}
            className="flex cursor-pointer items-start gap-[0.75em] px-[0.75em] py-[0.65em] transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
            style={{ borderRadius: "var(--ob-radius-md)", background: on ? tint("primary", 9) : "transparent", outlineColor: "var(--ob-primary)" }}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={on}
              onChange={() => onAnswer(on ? picked.filter((p) => p !== it.id) : [...picked, it.id])}
            />
            <span className="mt-[0.05em]">
              <Mark shape="box" state={on ? "on" : "off"} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block leading-snug">{it.label}</span>
              {it.hint && (
                <span className="mt-[0.15em] block text-[0.8125em] leading-snug" style={{ color: "var(--ob-muted)" }}>
                  {it.hint}
                </span>
              )}
            </span>
            {showPoints && (
              <span
                className="shrink-0 text-[0.8125em] font-semibold tabular-nums transition-colors"
                style={{ color: on ? "var(--ob-primary)" : "var(--ob-muted)" }}
              >
                +{per}
              </span>
            )}
          </motion.label>
        );
      })}
    </fieldset>
  );
}

function RewardBody({ earnedBadges, item }: BodyProps) {
  if (earnedBadges.length === 0) return null;
  return (
    <motion.ul variants={item} className="m-0 flex list-none flex-wrap justify-center gap-[0.5em] p-0" aria-label="Badges earned">
      {earnedBadges.map((b) => (
        <li
          key={b.id}
          className="inline-flex items-center gap-[0.4em] py-[0.35em] pl-[0.4em] pr-[0.8em] text-[0.875em] font-medium"
          style={{ borderRadius: 999, background: tint("primary", 10), color: "var(--ob-text)" }}
        >
          <span aria-hidden className="grid size-[1.6em] place-items-center rounded-full" style={{ background: "var(--ob-surface)" }}>
            {b.emoji}
          </span>
          {b.label}
        </li>
      ))}
    </motion.ul>
  );
}
