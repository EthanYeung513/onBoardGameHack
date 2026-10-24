"use client";

import type { FocusEvent } from "react";
import { levelFor, levelLabel, tints, withAlpha, xpAt } from "@/lib/orthogonal/theme";
import type { Level, Step } from "@/lib/orthogonal/types";
import { BrowserDots, Diamond, SwitchTrack } from "../ui";

interface Props {
  steps: Step[];
  cur: number;
  /** How many steps exist yet; 0 shows a loading skeleton. */
  built: number;
  levels: Level[];
  siteUrl: string;
  badgeColor: string;
  width: number;
  /** Title and description become editable in place. */
  editable: boolean;
  celebrate: boolean;
  onEdit: (field: "title" | "description", value: string) => void;
  onPrev: () => void;
  onNext: () => void;
}

/** The onboarding as the customer's users will see it, inside a browser frame. */
export function StepPreview({ steps, cur, built, levels, siteUrl, badgeColor, width, editable, celebrate, onEdit, onPrev, onNext }: Props) {
  const step = steps[cur];
  const { bg, fg, accent, onAccent } = step.theme;
  const { line, track } = tints(fg);
  const total = steps.reduce((sum, s) => sum + s.xp, 0);
  const xp = xpAt(steps, cur);
  const level = levelFor(levels, xp, total);
  const isLast = cur === steps.length - 1;
  const save = (field: "title" | "description") => (e: FocusEvent<HTMLElement>) => onEdit(field, e.currentTarget.textContent ?? "");
  const editableClass = "cursor-text focus:rounded focus:outline-2 focus:outline-offset-4 focus:outline-azure";

  return (
    <div
      className="shrink-0 overflow-hidden rounded-[18px] bg-white shadow-[0_30px_80px_rgba(0,0,0,.4)] transition-[width] duration-400 ease-in-out"
      style={{ width: `min(${width}px, 100%)` }}
    >
      <div className="flex items-center gap-2 border-b border-black/8 bg-[#f3f3f3] px-3.5 py-2.5">
        <BrowserDots />
        <span className="ml-2.5 flex-1 truncate rounded-md bg-white px-2.5 py-1 text-xs text-black/50">app.{siteUrl}/welcome</span>
      </div>

      <div
        className="relative flex min-h-[520px] flex-col overflow-hidden px-8 pt-[26px] pb-[30px] transition-[background-color,color] duration-700 ease-in-out"
        style={{ background: bg, color: fg }}
      >
        {celebrate && <Confetti />}

        <div className="relative mb-9 flex items-center gap-3.5">
          <span className="inline-block size-3 rounded-full transition-[background-color] duration-700" style={{ background: accent }} />
          <div className="h-1.5 flex-1 rounded-[3px]" style={{ background: track }}>
            <div
              className="h-full rounded-[3px] transition-[width,background-color] duration-700 ease-in-out"
              style={{ background: accent, width: `${total ? Math.round((xp / total) * 100) : 0}%` }}
            />
          </div>
          <span className="text-[13px] font-semibold tabular-nums">{xp} XP</span>
          <span
            className="rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-[background-color,color] duration-700"
            style={{ background: accent, color: onAccent }}
          >
            {levelLabel(level)}
          </span>
        </div>

        {built === 0 ? (
          <div className="flex flex-1 flex-col justify-center gap-3.5">
            {[
              ["h-7 w-3/5 rounded-lg", "0s"],
              ["h-3.5 w-4/5 rounded-md", ".2s"],
              ["h-3.5 w-1/2 rounded-md", ".4s"],
            ].map(([cls, delay]) => (
              <div key={delay} className={`animate-shimmer ${cls}`} style={{ background: withAlpha(fg, 0.08), animationDelay: delay }} />
            ))}
          </div>
        ) : (
          <div key={step.id} className="relative flex flex-1 animate-[o-pop_.45s_ease_both] flex-col">
            <div className="mb-3.5 text-xs font-semibold tracking-[.06em] uppercase opacity-60">
              Step {cur + 1} of {steps.length}
            </div>
            <h3
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={save("title")}
              className={`mt-0 mb-3 max-w-[13ch] text-[clamp(30px,4vw,46px)] leading-none font-semibold tracking-[-.025em] text-balance ${editableClass}`}
            >
              {step.title}
            </h3>
            <p
              contentEditable={editable}
              suppressContentEditableWarning
              onBlur={save("description")}
              className={`mt-0 mb-7 max-w-[420px] text-base leading-[1.45] opacity-70 ${editableClass}`}
            >
              {step.description}
            </p>

            <StepBody step={step} line={line} total={total} topLevel={levels.at(-1)?.level ?? 1} badges={steps.map((s) => s.badge)} badgeColor={badgeColor} />

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-[30px]">
              <div className="flex items-center gap-3">
                <span className="inline-block size-[22px] rotate-45 rounded-[5px] transition-[background-color] duration-700" style={{ background: accent }} />
                <div>
                  <div className="text-[11px] tracking-[.04em] uppercase opacity-60">{step.kind === "done" ? "All badges earned" : "Unlocks"}</div>
                  <div className="text-sm font-semibold">{step.badge}</div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={onPrev} className="h-11 cursor-pointer border-0 bg-transparent px-3.5 text-[15px] font-semibold text-inherit opacity-60">
                  Back
                </button>
                <button
                  type="button"
                  onClick={onNext}
                  className="h-[46px] cursor-pointer rounded-full border-0 px-[22px] text-[15px] font-semibold transition-[background-color,color] duration-700"
                  style={{ background: fg, color: bg }}
                >
                  {isLast ? "Open dashboard" : `Continue · +${step.xp} XP`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepBody({ step, line, total, topLevel, badges, badgeColor }: { step: Step; line: string; total: number; topLevel: number; badges: string[]; badgeColor: string }) {
  const { accent, onAccent, fg } = step.theme;
  switch (step.kind) {
    case "choice":
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
          {(step.options ?? []).map((option, i) => {
            const selected = i === 0;
            return (
              <div
                key={option}
                className="flex items-center gap-2.5 rounded-xl border-[1.5px] px-3.5 py-4 text-[15px] font-semibold"
                style={{ borderColor: selected ? accent : line, background: selected ? accent : "transparent" }}
              >
                <span
                  className="inline-block size-4 rounded-full border-2"
                  style={{ borderColor: selected ? onAccent : fg, background: selected ? onAccent : "transparent" }}
                />
                {option}
              </div>
            );
          })}
        </div>
      );
    case "fields":
      return (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          {(step.fields ?? []).map((field) => (
            <div key={field.label}>
              <div className="mb-1.5 text-[13px] font-semibold opacity-70">{field.label}</div>
              <div
                className={`flex h-12 items-center rounded-xl border-[1.5px] px-3.5 text-base ${field.kind === "computed" ? "opacity-50" : "font-semibold"} ${field.kind === "select" ? "justify-between" : ""}`}
                style={{ borderColor: line }}
              >
                {field.value}
                {field.kind === "select" && <span className="opacity-50">⌄</span>}
              </div>
            </div>
          ))}
        </div>
      );
    case "toggles":
      return (
        <div className="flex flex-col gap-2.5">
          {(step.toggles ?? []).map((t) => (
            <div key={t.title} className="flex items-center justify-between rounded-xl border-[1.5px] px-4 py-3.5" style={{ borderColor: line }}>
              <div>
                <div className="text-[15px] font-semibold">{t.title}</div>
                <div className="text-[13px] opacity-60">{t.description}</div>
              </div>
              <SwitchTrack on={t.on} bg={t.on ? accent : line} knob={t.on ? onAccent : fg} />
            </div>
          ))}
        </div>
      );
    case "done":
      return (
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-baseline gap-3">
            <span className="text-[clamp(40px,6vw,64px)] leading-none font-semibold tracking-[-.03em]">{total} XP</span>
            <span className="text-[15px] opacity-70">Level {topLevel} reached</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge, i) => (
              <div
                key={`${badge}-${i}`}
                className="flex animate-[o-pop_.4s_ease_both] items-center gap-2 rounded-full border-[1.5px] py-2 pr-3 pl-2 text-[13px] font-semibold"
                style={{ borderColor: line }}
              >
                <Diamond size={14} color={badgeColor} className="rounded-[2px]" />
                {badge}
              </div>
            ))}
          </div>
        </div>
      );
    case "welcome":
      return (
        <div className="flex flex-wrap gap-2">
          {(step.chips ?? []).map((chip) => (
            <span key={chip} className="rounded-full border-[1.5px] px-3.5 py-2.5 text-sm font-medium" style={{ borderColor: line }}>
              {chip}
            </span>
          ))}
        </div>
      );
  }
}

const CONFETTI_COLOURS = ["#F5B400", "#FBF7EE", "#FF5A3C", "#2D8CFF"];

function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {Array.from({ length: 30 }, (_, i) => (
        <span
          key={i}
          className="absolute top-0"
          style={{
            left: `${(i * 37) % 100}%`,
            width: 8 + (i % 3) * 3,
            height: 10 + (i % 4) * 3,
            borderRadius: i % 2 ? "50%" : 2,
            background: CONFETTI_COLOURS[i % 4],
            animation: `o-confetti ${2.6 + (i % 5) * 0.3}s ${(i * 0.17) % 2}s ease-out infinite`,
          }}
        />
      ))}
    </div>
  );
}
