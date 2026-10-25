"use client";

import { useEffect, useRef } from "react";
import type { GameId, GameResult } from "./types";
import styles from "./GameResults.module.css";

const seconds = (ms: number) => `${Math.max(1, Math.round(ms / 1000))}s`;

/** Drops a trailing "Source: …" a generated explanation may carry, when the card shows the source on its own line. */
export const withoutSourceTail = (explanation: string) => explanation.replace(/\s*[(\[]?\bSource:.*$/is, "").trim();

/** Each game's own name for its end screen, so the results read as part of that game. */
const KICKER: Record<GameId, string> = {
  battle: "Battle report",
  dilemma: "The verdict",
  "word-match": "Final score",
};

/** The end screen every game shares: score, accuracy, time, and each mistake with the right answer and source. */
export function GameResults({
  game,
  title,
  result,
  onReplay,
  onExit,
}: {
  /** Skins the screen in that game's look; omitted, it uses the site's paper style. */
  game?: GameId;
  title: string;
  result: GameResult;
  onReplay?: () => void;
  onExit?: () => void;
}) {
  const accuracy = result.total ? Math.round((result.correct / result.total) * 100) : 0;
  const top = useRef<HTMLDivElement>(null);
  // The game before was often taller (a phone's word board), so its scroll position would open the results mid-list.
  useEffect(() => top.current?.scrollIntoView({ block: "start" }), []);
  return (
    <div ref={top} className={`${styles.screen} ${game ? styles[game] : ""} ${result.won ? "" : styles.lost}`}>
      <section className={styles.card} aria-label="Results">
        <div className={styles.header}>
          {game && <p className={styles.kicker}>{KICKER[game]}</p>}
          <h2 className={styles.headline}>{result.won ? "Cleared!" : "Not yet. Study and retry."}</h2>
          <p className={styles.course}>{title}</p>
        </div>
        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Score</dt>
            <dd className={styles.statValue}>
              {result.score}
              <span className={styles.statMax}>/{result.maxScore}</span>
            </dd>
          </div>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Accuracy</dt>
            <dd className={styles.statValue}>{accuracy}%</dd>
          </div>
          <div className={styles.stat}>
            <dt className={styles.statLabel}>Time</dt>
            <dd className={styles.statValue}>{seconds(result.durationMs)}</dd>
          </div>
        </dl>
        {result.mistakes.length > 0 && (
          <div>
            <h3 className={styles.reviewTitle}>To review</h3>
            <ul className={styles.mistakes}>
              {result.mistakes.map((m, i) => (
                <li key={`${m.itemId}-${i}`} className={styles.mistake}>
                  <p className={styles.prompt}>{m.prompt}</p>
                  <p className={styles.chosen}>
                    <span aria-hidden>✗</span> You: {m.chosen}
                  </p>
                  <p className={styles.expected}>
                    <span aria-hidden>✓</span> Answer: {m.expected}
                  </p>
                  {m.explanation && (
                    <p className={styles.explanation}>{m.source ? withoutSourceTail(m.explanation) || m.explanation : m.explanation}</p>
                  )}
                  {m.source && (
                    <p className={styles.source}>
                      Source: {m.source.doc}
                      {m.source.section ? ` › ${m.source.section}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={styles.actions}>
          {onReplay && (
            <button onClick={onReplay} className={styles.primary}>
              Play again
            </button>
          )}
          {onExit && (
            <button onClick={onExit} className={styles.secondary}>
              Done
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
