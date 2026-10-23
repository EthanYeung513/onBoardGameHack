"use client";

import { useCallback, useEffect, useState } from "react";
import { Evidence, ScoreBadge } from "@/components/ui/ScoreBadge";
import { getJson, postJson } from "@/lib/api";
import type { QueueCard, QueueGrade } from "@/services/review";

interface Queue {
  grades: QueueGrade[];
  cards: QueueCard[];
}

export function ReviewQueue({ reviewer = "Manager", pollMs = 4000 }: { reviewer?: string; pollMs?: number }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setQueue(await getJson<Queue>("/api/review"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial load plus polling, so new grades appear live while a hire plays.
    const first = setTimeout(load, 0);
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [load, pollMs]);

  if (error) return <p className="text-red-700">Couldn&apos;t load the queue: {error}</p>;
  if (!queue) return <p>Loading review queue…</p>;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-xl font-bold">Grades to review ({queue.grades.length})</h2>
        {queue.grades.length === 0 && <p className="text-ink/70">Nothing waiting. New answers appear here as hires play.</p>}
        <ul className="flex flex-col gap-4">
          {queue.grades.map((g) => (
            <GradeItem key={g.gradeId} grade={g} reviewer={reviewer} onDone={load} />
          ))}
        </ul>
      </section>
      {queue.cards.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold">Cards to approve ({queue.cards.length})</h2>
          <ul className="flex flex-col gap-4">
            {queue.cards.map((c) => (
              <CardItem key={c.cardId} card={c} reviewer={reviewer} onDone={load} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function GradeItem({ grade, reviewer, onDone }: { grade: QueueGrade; reviewer: string; onDone: () => void }) {
  const [overriding, setOverriding] = useState(false);
  const [score, setScore] = useState(grade.scores[grade.competency] ?? 0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border-2 border-ink/15 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm text-ink/70">
        <span className="font-semibold text-ink">{grade.learnerName}</span>
        <span>· {grade.learnerRole}</span>
        <span>· {grade.competency}</span>
        <span>· grader {grade.modelVersion}</span>
        {grade.retrievedCorrections > 0 && (
          <span className="rounded bg-sky-100 px-1.5 text-sky-800">used {grade.retrievedCorrections} past ruling(s)</span>
        )}
      </div>
      <p className="mb-2 text-sm italic">{grade.cardPrompt}</p>
      <blockquote className="mb-3 border-l-4 border-ink/20 pl-3">
        <Evidence answer={grade.answer} quote={grade.evidenceQuote} />
      </blockquote>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {Object.entries(grade.scores).map(([c, s]) => (
          <ScoreBadge key={c} score={s} label="AI" />
        ))}
        <span className="text-sm">{grade.feedback}</span>
      </div>
      {!overriding ? (
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => act(() => postJson(`/api/grades/${grade.gradeId}/approve`, { reviewer }))}
            className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button disabled={busy} onClick={() => setOverriding(true)} className="rounded border-2 border-ink px-3 py-1.5 font-semibold">
            Override
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => postJson("/api/corrections", { gradeId: grade.gradeId, correctedScores: { [grade.competency]: score }, reason, reviewer }));
          }}
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Corrected score">
            {[0, 1, 2, 3].map((s) => (
              <label
                key={s}
                className={`cursor-pointer rounded border-2 px-3 py-1 ${s === score ? "border-ink bg-ink text-paper" : "border-ink/30"}`}
                title={grade.levels?.[String(s) as "0"]}
              >
                <input type="radio" name={`score-${grade.gradeId}`} value={s} checked={s === score} onChange={() => setScore(s)} className="sr-only" />
                {s}
              </label>
            ))}
          </div>
          {grade.levels && <p className="text-sm text-ink/70">{grade.levels[String(score) as "0"]}</p>}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="One line: why (e.g. we always call back on the number on file)"
            aria-label="Reason"
            className="rounded border-2 border-ink/30 px-3 py-2"
            required
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !reason.trim()} className="rounded bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-50">
              Save correction
            </button>
            <button type="button" onClick={() => setOverriding(false)} className="px-3 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

function CardItem({ card, reviewer, onDone }: { card: QueueCard; reviewer: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState(card.prompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const edited = prompt !== card.prompt;

  const send = async (action: "approve" | "edit" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await postJson(`/api/cards/${card.cardId}/review`, { action, reviewer, edits: action === "edit" ? { prompt } : undefined });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border-2 border-dashed border-ink/30 bg-white p-4">
      <div className="mb-2 text-sm text-ink/70">
        {card.gymName} · {card.type} · {card.competency}{" "}
        {card.status === "stale" && <span className="rounded bg-amber-200 px-1.5 text-amber-900">policy changed</span>}
        {card.sourceHeading && <span> · cites “{card.sourceHeading}”</span>}
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Card prompt" className="mb-2 w-full rounded border-2 border-ink/20 p-2" rows={3} />
      {card.choices && (
        <ol className="mb-2 list-[upper-alpha] pl-6 text-sm">
          {card.choices.map((c, i) => (
            <li key={i} className={i === card.answerIdx ? "font-bold" : ""}>
              {c}
            </li>
          ))}
        </ol>
      )}
      <div className="flex gap-2">
        <button disabled={busy} onClick={() => send(edited ? "edit" : "approve")} className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
          {edited ? "Save edit" : "Approve"}
        </button>
        <button disabled={busy} onClick={() => send("reject")} className="rounded border-2 border-ink px-3 py-1.5 font-semibold">
          Reject
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
