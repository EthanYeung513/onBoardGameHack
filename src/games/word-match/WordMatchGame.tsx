"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blip, sweep, thud } from "../core/sound";
import type { GameProps } from "../core/types";
import { createWordMatch, maxScore, MAX_MULTIPLIER, nextBoard, select, timeUp, type Side, type WordMatchState } from "./logic";
import type { WordMatchSpec } from "./spec";
import styles from "./wordmatch.module.css";

type Phase = "title" | "countdown" | "play" | "clear" | "over";
type Fx =
  | { id: number; kind: "line"; x1: number; y1: number; x2: number; y2: number }
  | { id: number; kind: "burst"; x: number; y: number; colors: string[] }
  | { id: number; kind: "points"; x: number; y: number; text: string }
  | { id: number; kind: "callout"; text: string; glow: string }
  | { id: number; kind: "missFlash" };

/** Omit that keeps each variant of a union separate. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type FxInput = DistributiveOmit<Fx, "id">;

const BANNER_MS = 1700;
const FX_MS = 1100;
const SPARK_COLORS = ["#ffe066", "#ff4fd8", "#22e3ff", "#ffffff"];
const COMBO_GLOW = ["#22e3ff", "#22e3ff", "#7b4dff", "#ff4fd8", "#ff8a3b", "#ffe066"];

export function WordMatchGame({ spec, onComplete, instant = false }: GameProps<WordMatchSpec>) {
  const [game, setGame] = useState<WordMatchState>(() => createWordMatch(spec));
  const [phase, setPhase] = useState<Phase>("title");
  const [count, setCount] = useState(3);
  const [fx, setFx] = useState<Fx[]>([]);
  const [shake, setShake] = useState<{ term: number; meaning: number; key: number } | null>(null);
  const [brokenHeart, setBrokenHeart] = useState<number | null>(null);
  const [lastMatch, setLastMatch] = useState<number | null>(null);
  const [scoreKey, setScoreKey] = useState(0);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(0);
  const [banner, setBanner] = useState<{ text: string; sub?: string; key: number } | null>(null);
  const [confetti, setConfetti] = useState(0);
  const [sound, setSound] = useState(!instant);
  const arena = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const fxId = useRef(0);
  const keySeq = useRef(0);
  const startedAt = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = useCallback((ms: number, fn: () => void) => (instant ? fn() : void timers.current.push(setTimeout(fn, ms))), [instant]);
  const sfx = useCallback((fn: () => void) => sound && !instant && fn(), [sound, instant]);

  const addFx = useCallback(
    (items: FxInput[]) => {
      if (instant) return;
      const withIds = items.map((f) => ({ ...f, id: ++fxId.current }) as Fx);
      setFx((list) => [...list, ...withIds]);
      const ids = new Set(withIds.map((f) => f.id));
      later(FX_MS, () => setFx((list) => list.filter((f) => !ids.has(f.id))));
    },
    [instant, later],
  );

  /** Centre of a card relative to the arena, for lines and bursts. */
  const centre = (side: Side, pair: number) => {
    const el = cards.current.get(`${side}-${pair}`);
    const box = arena.current?.getBoundingClientRect();
    if (!el || !box) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, left: r.left - box.left, right: r.right - box.left };
  };

  const startBoard = useCallback(() => {
    const t = Date.now();
    setNow(t);
    setDeadline(t + spec.timeLimitSec * 1000);
    setPhase("play");
  }, [spec.timeLimitSec]);

  const start = () => {
    startedAt.current = Date.now();
    if (instant) return startBoard();
    setPhase("countdown");
    setCount(3);
    sfx(() => blip(440, 120));
    [2, 1, 0].forEach((n, i) =>
      later((i + 1) * 700, () => {
        setCount(n);
        sfx(() => blip(n === 0 ? 880 : 440, n === 0 ? 260 : 120));
        if (n === 0) later(500, startBoard);
      }),
    );
  };

  // Clock: ticks while a board is in play, and ends the board when time runs out.
  useEffect(() => {
    if (instant || phase !== "play") return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        setGame((g) => timeUp(g, spec));
        setPhase("over");
        sfx(() => sweep(500, 80, 700, "sawtooth", 0.05));
      }
    }, 200);
    return () => clearInterval(id);
  }, [instant, phase, deadline, spec, sfx]);

  const pick = (side: Side, pair: number) => {
    if (phase !== "play") return;
    const { state: next, event } = select(game, spec, side, pair);
    setGame(next);
    if (event.type === "selected") sfx(() => blip(side === "term" ? 620 : 760, 40));
    if (event.type === "deselected") sfx(() => blip(380, 30));

    if (event.type === "match") {
      setLastMatch(event.pair);
      setScoreKey((k) => k + 1);
      const a = centre("term", event.pair);
      const b = centre("meaning", event.pair);
      const items: FxInput[] = [];
      if (a && b) {
        items.push({ kind: "line", x1: a.right, y1: a.y, x2: b.left, y2: b.y });
        items.push({ kind: "burst", x: a.x, y: a.y, colors: SPARK_COLORS });
        items.push({ kind: "burst", x: b.x, y: b.y, colors: SPARK_COLORS });
        items.push({ kind: "points", x: b.x, y: b.y - 24, text: `+${event.points}` });
      }
      if (event.combo >= 2) items.push({ kind: "callout", text: event.combo >= MAX_MULTIPLIER ? "MAX COMBO!" : `COMBO x${event.combo}!`, glow: COMBO_GLOW[Math.min(event.combo, 5)] });
      addFx(items);
      sfx(() => {
        blip(520 + event.combo * 90, 70, "square", 0.04);
        later(80, () => blip(780 + event.combo * 90, 110, "square", 0.04));
      });

      if (next.status === "boardClear" || next.status === "won") {
        const perfect = next.boardMisses === 0;
        later(450, () => {
          setPhase(next.status === "won" ? "over" : "clear");
          setBanner({ text: next.status === "won" ? "STAGE CLEAR!" : "BOARD CLEAR!", sub: perfect ? "★ PERFECT! ★" : undefined, key: ++keySeq.current });
          setConfetti((c) => c + 1);
          sfx(() => [523, 659, 784, 1047].forEach((f, i) => later(i * 110, () => blip(f, 140, "square", 0.04))));
        });
        if (next.status === "boardClear") {
          later(450 + BANNER_MS, () => {
            setBanner(null);
            setGame((g) => nextBoard(g, spec));
            startBoard();
          });
        }
      }
    }

    if (event.type === "miss") {
      const shakeKey = ++keySeq.current;
      setShake({ term: event.term, meaning: event.meaning, key: shakeKey });
      later(500, () => setShake((s) => (s?.key === shakeKey ? null : s)));
      setBrokenHeart(next.lives);
      addFx([{ kind: "missFlash" }, { kind: "callout", text: "MISS!", glow: "#ff3b5c" }]);
      sfx(() => {
        sweep(220, 90, 280, "sawtooth", 0.06);
        thud(120, 0.2);
      });
      if (next.status === "lost") later(700, () => setPhase("over"));
    }
  };

  const finish = () =>
    onComplete?.({
      gameId: "word-match",
      won: game.status === "won",
      score: game.score,
      maxScore: maxScore(spec),
      correct: game.correct,
      total: Math.max(game.attempts, game.correct + game.mistakes.length),
      durationMs: Date.now() - startedAt.current,
      mistakes: game.mistakes,
    });

  const remaining = phase === "play" || phase === "clear" ? Math.max(0, deadline - now) : spec.timeLimitSec * 1000;
  const timePct = instant ? 100 : (remaining / (spec.timeLimitSec * 1000)) * 100;
  const danger = !instant && phase === "play" && remaining <= 10000;
  const pairs = game.boards[game.board];

  const card = (side: Side, pair: number, i: number) => {
    const matched = game.matched.includes(pair);
    const selected = game.selected?.side === side && game.selected.pair === pair;
    const missed = !matched && shake && (side === "term" ? shake.term === pair : shake.meaning === pair);
    const text = side === "term" ? spec.pairs[pair].term : spec.pairs[pair].meaning;
    return (
      <button
        key={`${game.board}-${side}-${pair}-${missed ? shake!.key : 0}`}
        ref={(el) => {
          if (el) cards.current.set(`${side}-${pair}`, el);
          else cards.current.delete(`${side}-${pair}`);
        }}
        className={`${styles.card} ${side === "term" ? styles.term : styles.meaning} ${selected ? styles.selected : ""} ${matched ? styles.matched : ""} ${missed ? styles.miss : ""}`}
        style={{ animationDelay: matched || missed || selected ? undefined : `${i * 70 + (side === "meaning" ? 35 : 0)}ms` }}
        disabled={matched || phase !== "play"}
        aria-pressed={selected}
        onClick={() => pick(side, pair)}
      >
        {text}
      </button>
    );
  };

  return (
    <div ref={arena} className={styles.arena} data-testid="word-match">
      <button className={styles.soundToggle} onClick={() => setSound((s) => !s)} aria-label={sound ? "Mute" : "Unmute"}>
        {sound ? "🔊" : "🔇"}
      </button>
      <div className={styles.hud}>
        <div className={styles.hudLeft}>
          <div className={styles.hudTitle}>{spec.title}</div>
          <div>
            BOARD {game.board + 1}/{game.boards.length}
          </div>
        </div>
        <div key={scoreKey} className={`${styles.score} ${scoreKey ? styles.scoreBump : ""}`} aria-label={`Score ${game.score}`}>
          <span className={styles.scoreLabel}>SCORE</span>
          {String(game.score).padStart(5, "0")}
        </div>
        <div className={styles.hearts} aria-label={`${game.lives} of ${spec.lives} lives left`}>
          {Array.from({ length: spec.lives }, (_, i) => (
            <span key={`${i}-${brokenHeart === i ? "broken" : ""}`} className={`${styles.heart} ${i === brokenHeart ? styles.heartBreak : i >= game.lives ? styles.heartLost : ""}`}>
              ❤️
            </span>
          ))}
        </div>
      </div>

      <div className={styles.comboMeter} aria-label={`Combo ${game.combo}`}>
        {Array.from({ length: MAX_MULTIPLIER }, (_, i) => (
          <span key={i} className={`${styles.comboPip} ${i < game.combo ? styles.comboPipOn : ""}`} />
        ))}
      </div>

      <div className={styles.timer} role="timer" aria-label={`${Math.ceil(remaining / 1000)} seconds left`}>
        <div className={`${styles.timerFill} ${danger ? styles.timerDanger : ""}`} style={{ width: `${timePct}%` }} />
      </div>

      <div className={styles.board}>
        <div>
          <div className={styles.columnLabel}>TERMS</div>
          <div className={styles.column}>{phase !== "title" && phase !== "countdown" && game.terms.map((p, i) => card("term", p, i))}</div>
        </div>
        <div>
          <div className={styles.columnLabel}>MEANINGS</div>
          <div className={styles.column}>{phase !== "title" && phase !== "countdown" && game.meanings.map((p, i) => card("meaning", p, i))}</div>
        </div>
      </div>

      <div className={styles.ticker} aria-live="polite">
        {lastMatch !== null ? (
          <div key={lastMatch} className={styles.tickerEnter}>
            <span className={styles.tickerTerm}>{spec.pairs[lastMatch].term}</span>: {spec.pairs[lastMatch].meaning}
          </div>
        ) : (
          <span>Pick a term, then its meaning (either order works). {pairs.length} pairs on this board.</span>
        )}
      </div>

      <div className={styles.fx} aria-hidden>
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          {fx.map((f) => (f.kind === "line" ? <line key={f.id} className={styles.line} x1={f.x1} y1={f.y1} x2={f.x2} y2={f.y2} /> : null))}
        </svg>
        {fx.map((f) => {
          if (f.kind === "burst")
            return (
              <div key={f.id} className={styles.burst} style={{ left: f.x, top: f.y }}>
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    className={styles.spark}
                    style={{ "--a": `${i * 30}deg`, "--d": `${50 + (i % 3) * 18}px`, "--c": f.colors[i % f.colors.length] } as React.CSSProperties}
                  />
                ))}
              </div>
            );
          if (f.kind === "points")
            return (
              <div key={f.id} className={styles.points} style={{ left: f.x, top: f.y }}>
                {f.text}
              </div>
            );
          if (f.kind === "callout")
            return (
              <div key={f.id} className={styles.callout} style={{ "--glow": f.glow } as React.CSSProperties}>
                {f.text}
              </div>
            );
          if (f.kind === "missFlash") return <div key={f.id} className={styles.missFlash} />;
          return null;
        })}
      </div>

      {banner && (
        <div key={banner.key} className={styles.banner}>
          {banner.text}
          {banner.sub && <span className={styles.bannerSub}>{banner.sub}</span>}
        </div>
      )}
      {confetti > 0 &&
        !instant &&
        Array.from({ length: 36 }, (_, i) => (
          <span
            key={`${confetti}-${i}`}
            className={styles.confetti}
            style={
              {
                left: `${(i * 37) % 100}%`,
                "--c": SPARK_COLORS[i % SPARK_COLORS.length],
                "--t": `${1.4 + (i % 5) * 0.25}s`,
                "--r": `${(i % 2 ? 1 : -1) * (360 + i * 20)}deg`,
                animationDelay: `${(i % 6) * 60}ms`,
              } as React.CSSProperties
            }
          />
        ))}

      {phase === "title" && (
        <div className={styles.overlay}>
          <div className={styles.overlayTitle}>{spec.title}</div>
          {spec.intro && <p className={styles.overlayText}>{spec.intro}</p>}
          <p className={styles.overlayText}>
            {spec.pairs.length} pairs · {game.boards.length} boards · {spec.timeLimitSec}s each · {spec.lives} lives
          </p>
          <button className={styles.arcadeButton} onClick={start}>
            INSERT COIN ▶ START
          </button>
        </div>
      )}
      {phase === "countdown" && (
        <div className={styles.overlay}>
          <div key={count} className={styles.countdown}>
            {count === 0 ? "GO!" : count}
          </div>
        </div>
      )}
      {phase === "over" && (
        <div className={styles.overlay} style={{ background: game.status === "won" ? "rgba(10, 6, 32, 0.55)" : undefined }}>
          <div className={styles.overlayTitle}>{game.status === "won" ? "YOU WIN!" : game.status === "timeUp" ? "TIME UP!" : "GAME OVER"}</div>
          <p className={styles.overlayText}>
            Score {game.score} · best combo x{game.bestCombo}
          </p>
          <button className={styles.arcadeButton} onClick={finish}>
            SEE RESULTS
          </button>
        </div>
      )}
    </div>
  );
}
