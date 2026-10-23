"use client";

import { useState } from "react";
import { applyTurn, nextTurn, startBattle, type BattleState } from "@/game/battle";
import { postJson } from "@/lib/api";
import type { SubmitResult } from "@/services/grading";
import type { PublicCard } from "@/services/world";
import { Creature } from "./Creature";
import { GradeDisplay } from "./GradeDisplay";

export interface BattleProps {
  title: string;
  foeName: string;
  foeKind: string;
  cards: PublicCard[];
  learnerId: string;
  onFinish: (won: boolean) => void;
}

function HpBar({ label, hp, max }: { label: string; hp: number; max: number }) {
  const pct = Math.round((hp / max) * 100);
  const colour = pct > 50 ? "bg-emerald-500" : pct > 20 ? "bg-amber-400" : "bg-red-600";
  return (
    <div className="w-40 sm:w-56">
      <div className="flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span>
          HP {hp}/{max}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-white" role="progressbar" aria-label={`${label} HP`} aria-valuenow={hp} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full transition-all duration-500 ${colour}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EmailCard({ prompt }: { prompt: string }) {
  const [head, ...body] = prompt.split("\n\n");
  return (
    <div className="rounded border-2 border-ink/20 bg-white text-left">
      <pre className="whitespace-pre-wrap border-b border-ink/10 bg-ink/5 p-3 font-mono text-xs">{head}</pre>
      <p className="whitespace-pre-wrap p-3 text-sm">{body.join("\n\n")}</p>
    </div>
  );
}

/** One battle: a card per turn, answered by multiple choice or free text, graded through /api/grade. */
export function Battle({ title, foeName, foeKind, cards, learnerId, onFinish }: BattleProps) {
  const [state, setState] = useState<BattleState>(() => startBattle(cards.length));
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitted, setSubmitted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const card = cards[index];

  const submit = async (body: { choiceIdx?: number; answerText?: string }) => {
    if (!card) return;
    setBusy(true);
    setError(null);
    try {
      const res = await postJson<SubmitResult>("/api/grade", { learnerId, cardId: card.id, ...body });
      setResult(res);
      setSubmitted(body.answerText ?? "");
      const score = res.grade ? Math.min(...Object.values(res.grade.scores)) : undefined;
      setState((s) => applyTurn(s, { correct: res.correct, score }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    const next = nextTurn(state);
    setState(next);
    setResult(null);
    setAnswer("");
    if (next.phase === "question") setIndex((i) => i + 1);
  };

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-pixel text-sm leading-relaxed">{title}</h2>
      <div className="flex items-end justify-between gap-4 rounded-lg bg-gradient-to-b from-sky-100 to-emerald-100 p-4">
        <div className="flex flex-col items-start gap-2">
          <HpBar label="You" hp={state.playerHp} max={state.maxHp} />
          <span className="text-5xl" aria-hidden>
            🧑‍💼
          </span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <HpBar label={foeName} hp={state.foeHp} max={state.maxHp} />
          <Creature kind={foeKind} flash={state.lastHit?.target === "foe" && state.phase === "feedback"} />
        </div>
      </div>

      {state.lastHit && state.phase === "feedback" && (
        <p className="text-center text-sm font-semibold" aria-live="polite">
          {state.lastHit.target === "foe" ? `${state.lastHit.crit ? "Critical hit! " : ""}${foeName} took ${state.lastHit.amount} damage.` : `You took ${state.lastHit.amount} damage.`}
        </p>
      )}

      {state.phase === "question" && card && (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-ink/60">
            Turn {index + 1} of {cards.length} · {card.competency}
          </p>
          {card.type === "phish_email" ? <EmailCard prompt={card.prompt} /> : <p className="text-lg">{card.prompt}</p>}
          {card.choices ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {card.choices.map((choice, i) => (
                <button key={i} disabled={busy} onClick={() => submit({ choiceIdx: i })} className="rounded-lg border-2 border-ink bg-white px-3 py-2 text-left font-semibold hover:bg-gold/30 disabled:opacity-50">
                  {choice}
                </button>
              ))}
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (answer.trim()) submit({ answerText: answer });
              }}
            >
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={4} aria-label="Your answer" placeholder="What do you do, and why?" className="rounded-lg border-2 border-ink/30 p-3" />
              <button type="submit" disabled={busy || !answer.trim()} className="self-end rounded bg-ink px-4 py-2 font-semibold text-paper disabled:opacity-50">
                {busy ? "Grading…" : "Attack!"}
              </button>
            </form>
          )}
        </div>
      )}

      {state.phase === "feedback" && result && (
        <div className="flex flex-col gap-3">
          <GradeDisplay result={result} answer={submitted} />
          <button onClick={advance} className="self-end rounded bg-ink px-4 py-2 font-semibold text-paper">
            Continue
          </button>
        </div>
      )}

      {(state.phase === "won" || state.phase === "lost") && (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-pixel text-base">{state.phase === "won" ? `${foeName} fainted!` : "You blacked out…"}</p>
          <button onClick={() => onFinish(state.phase === "won")} className="rounded bg-ink px-4 py-2 font-semibold text-paper">
            {state.phase === "won" ? "Continue" : "Back"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
