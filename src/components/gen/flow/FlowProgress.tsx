"use client";

import { motion } from "motion/react";
import type { Outcome } from "@/lib/flow/scoring";
import type { Step } from "@/lib/flow/spec";
import { tint } from "./style";

export type NodeState = "done" | "missed" | "skipped" | "current" | "todo";

interface ProgressProps {
  steps: Step[];
  currentId: string;
  finished: boolean;
  outcomes: Record<string, Outcome>;
  /** Step ids of quiz questions answered wrongly. */
  missed: Set<string>;
  reduce: boolean;
}

function nodeStates({ steps, currentId, finished, outcomes, missed }: ProgressProps): NodeState[] {
  return steps.map((s) => {
    if (!finished && s.id === currentId) return "current";
    if (missed.has(s.id)) return "missed";
    if (outcomes[s.id] === "completed") return "done";
    if (outcomes[s.id] === "skipped") return "skipped";
    return "todo";
  });
}

function progressLabel(p: ProgressProps) {
  const pos = p.finished ? p.steps.length : Math.max(0, p.steps.findIndex((s) => s.id === p.currentId)) + 1;
  return { pos, text: `Step ${Math.min(pos, p.steps.length)} of ${p.steps.length}` };
}

export function ProgressBar(p: ProgressProps) {
  const states = nodeStates(p);
  const { pos, text } = progressLabel(p);
  return (
    <div className="flex items-center gap-[0.75em]">
      <div
        role="progressbar"
        aria-label="Progress"
        aria-valuemin={0}
        aria-valuemax={p.steps.length}
        aria-valuenow={pos}
        aria-valuetext={text}
        className="flex flex-1 gap-[3px]"
      >
        {states.map((st, i) => (
          <span
            key={p.steps[i].id}
            className="relative h-[6px] flex-1 overflow-hidden"
            style={{ borderRadius: 999, background: tint("muted", 16, "var(--ob-surface)") }}
          >
            <motion.span
              className="absolute inset-0 origin-left"
              initial={false}
              animate={{ scaleX: st === "todo" ? 0 : st === "current" ? 0.4 : 1 }}
              transition={p.reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
              style={{
                borderRadius: 999,
                background:
                  st === "missed"
                    ? "var(--ob-accent)"
                    : st === "skipped"
                      ? `repeating-linear-gradient(135deg, ${tint("muted", 45)} 0 3px, transparent 3px 6px)`
                      : "var(--ob-primary)",
              }}
            />
          </span>
        ))}
      </div>
      <span className="shrink-0 text-[0.75em] tabular-nums" style={{ color: "var(--ob-muted)" }}>
        {Math.min(pos, p.steps.length)}/{p.steps.length}
      </span>
    </div>
  );
}

const GAP = 46;
const PAD = 18;
const H = 58;
const AMP = 10;

/** Winding trail with one stop per visible step. Equal segment lengths keep pathLength proportional. */
export function PathMap(p: ProgressProps) {
  const n = p.steps.length;
  const states = nodeStates(p);
  const { pos, text } = progressLabel(p);
  const w = PAD * 2 + GAP * Math.max(1, n - 1);
  const pt = (i: number): [number, number] => [PAD + GAP * i, H / 2 + (i % 2 === 0 ? AMP : -AMP)];
  let d = `M ${pt(0)[0]} ${pt(0)[1]}`;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pt(i - 1);
    const [x1, y1] = pt(i);
    d += ` C ${x0 + GAP / 2} ${y0}, ${x1 - GAP / 2} ${y1}, ${x1} ${y1}`;
  }
  const reached = p.finished ? n - 1 : Math.max(0, pos - 1);
  const frac = n > 1 ? reached / (n - 1) : 1;
  const cur = pt(Math.min(reached, n - 1));
  const last = p.steps[n - 1];
  const finishGlyph = last?.type === "reward" && last.emoji ? last.emoji : "🏁";

  return (
    <div
      role="progressbar"
      aria-label="Progress"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={pos}
      aria-valuetext={text}
      className="w-full"
    >
      <svg viewBox={`0 0 ${w} ${H}`} className="block h-auto w-full" style={{ maxHeight: 64 }} aria-hidden>
        <path d={d} fill="none" stroke="var(--ob-border)" strokeWidth={3} strokeDasharray="1 7" strokeLinecap="round" />
        <motion.path
          d={d}
          fill="none"
          stroke="var(--ob-primary)"
          strokeWidth={3}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: frac }}
          transition={p.reduce ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        {!p.finished && (
          <motion.circle
            r={15}
            fill="none"
            stroke="var(--ob-accent)"
            strokeWidth={2}
            initial={false}
            animate={{ cx: cur[0], cy: cur[1] }}
            transition={p.reduce ? { duration: 0 } : { type: "spring", stiffness: 200, damping: 24 }}
          />
        )}
        {states.map((st, i) => {
          const [x, y] = pt(i);
          const isLast = i === n - 1;
          if (isLast) {
            return (
              <g key={p.steps[i].id}>
                <circle cx={x} cy={y} r={11} fill={st === "todo" ? "var(--ob-surface)" : tint("primary", 18)} stroke={st === "todo" ? "var(--ob-border)" : "var(--ob-primary)"} strokeWidth={2} />
                <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={11}>
                  {finishGlyph}
                </text>
              </g>
            );
          }
          const fill =
            st === "done" ? "var(--ob-primary)" : st === "missed" ? "var(--ob-accent)" : st === "current" ? "var(--ob-surface)" : "var(--ob-surface)";
          const stroke = st === "todo" || st === "skipped" ? "var(--ob-border)" : st === "current" ? "var(--ob-accent)" : fill;
          return (
            <g key={p.steps[i].id}>
              <circle cx={x} cy={y} r={st === "current" ? 8 : 7} fill={fill} stroke={stroke} strokeWidth={2} strokeDasharray={st === "skipped" ? "2 2" : undefined} />
              {st === "done" && (
                <path d={`M ${x - 3} ${y} l 2.2 2.2 l 4 -4.4`} fill="none" stroke="var(--ob-on-primary)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              )}
              {st === "current" && <circle cx={x} cy={y} r={3} fill="var(--ob-accent)" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
