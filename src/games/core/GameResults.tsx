"use client";

import type { GameResult } from "./types";

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/** The end screen every game shares: score, accuracy, time, and each mistake with the right answer and source. */
export function GameResults({ title, result, onReplay, onExit }: { title: string; result: GameResult; onReplay?: () => void; onExit?: () => void }) {
  const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  return (
    <section className="mx-auto flex w-full max-w-2xl flex-col gap-5 rounded-2xl border-4 border-ink bg-paper p-6 font-sans text-ink shadow-xl" aria-label="Results">
      <div className="text-center">
        <p className="text-5xl" aria-hidden>
          {result.won ? "🏆" : "📘"}
        </p>
        <h2 className="mt-2 font-pixel text-base leading-relaxed">{result.won ? "Cleared!" : "Not yet. Study and retry."}</h2>
        <p className="text-base text-ink/70">{title}</p>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-white p-3">
          <dt className="text-sm uppercase tracking-wide text-ink/70">Score</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {result.score}
            <span className="text-base font-normal text-ink/60">/{result.maxScore}</span>
          </dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="text-sm uppercase tracking-wide text-ink/70">Accuracy</dt>
          <dd className="text-2xl font-bold tabular-nums">{accuracy}%</dd>
        </div>
        <div className="rounded-lg bg-white p-3">
          <dt className="text-sm uppercase tracking-wide text-ink/70">Time</dt>
          <dd className="text-2xl font-bold tabular-nums">{seconds(result.durationMs)}</dd>
        </div>
      </dl>
      {result.mistakes.length > 0 && (
        <div>
          <h3 className="mb-2 font-bold">To review</h3>
          <ul className="flex flex-col gap-2">
            {result.mistakes.map((m, i) => (
              <li key={`${m.itemId}-${i}`} className="rounded-lg border-2 border-ink/10 bg-white p-3 text-base">
                <p className="font-semibold">{m.prompt}</p>
                <p className="text-red-800">
                  <span aria-hidden>✗</span> You: {m.chosen}
                </p>
                <p className="text-emerald-800">
                  <span aria-hidden>✓</span> Answer: {m.expected}
                </p>
                {m.explanation && <p className="mt-1 text-ink/80">{m.explanation}</p>}
                {m.source && (
                  <p className="mt-1 text-sm text-ink/70">
                    Source: {m.source.doc}
                    {m.source.section ? ` › ${m.source.section}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-center gap-2">
        {onReplay && (
          <button onClick={onReplay} className="rounded bg-ink px-4 py-2 font-semibold text-paper">
            Play again
          </button>
        )}
        {onExit && (
          <button onClick={onExit} className="rounded border-2 border-ink px-4 py-2 font-semibold">
            Done
          </button>
        )}
      </div>
    </section>
  );
}
