"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameId, GameResult } from "./types";
import { GamePlayer } from "./GamePlayer";
import { loadGameSave, writeGameSave, type GameSave } from "./save";
import { ASSET_BASE } from "../dilemma/sprites";
import styles from "./GameShell.module.css";

const FRONT_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated";
const OFFICE_BG = `${ASSET_BASE}/fey-co.-office-entrance.png`;

/** The shell's own labels per game: the real game's name, and a mascot line for its menu. */
const GAME_BRAND: Record<GameId, string> = {
  battle: "an Orthogonal battle",
  "word-match": "an Orthogonal arcade",
  dilemma: "an Orthogonal confrontation",
};

function accuracy(result: GameResult): number {
  return result.total ? Math.round((result.correct / result.total) * 100) : 0;
}

function savedLine(save: GameSave): string {
  if (save.status === "finished" && save.result) {
    const r = save.result;
    return `Last run: ${r.won ? "cleared" : "not cleared"} · ${r.score}/${r.maxScore} · ${accuracy(r)}%`;
  }
  return `Started ${new Date(save.savedAt).toLocaleDateString()}`;
}


function MenuOption({ label, note, onClick, autoFocus }: { label: string; note?: string; onClick: () => void; autoFocus?: boolean }) {
  return (
    <button className={styles.option} onClick={onClick} autoFocus={autoFocus}>
      <span className={styles.optionCursor} aria-hidden>
        ▶
      </span>
      {label}
      {note && <span className={styles.optionNote}>{note}</span>}
    </button>
  );
}

/**
 * The building's inside: the game's own full-screen main menu (course name, real assets and fonts),
 * then the game filling the page. Continue replays the exact spec the last run was saved with.
 *
 * During play a Menu button (top corner) or ESC pauses the run: Resume, or Leave the building.
 * Leaving keeps the run mounted but paused behind the menu (the caller hides the shell), so coming
 * back and choosing Continue picks up exactly where the hire stopped; after a reload, Continue
 * replays the saved spec.
 */
export function GameShell({
  game,
  spec,
  packId,
  packTitle,
  exitHref,
  onExit,
  onComplete,
}: {
  game: GameId;
  spec: unknown;
  packId: string;
  /** The course's name, shown as the menu title, never the minigame's name. */
  packTitle: string;
  exitHref?: string;
  /** In-app exit (e.g. back to the world's town), shown as "Leave the building" in place of the link. */
  onExit?: () => void;
  /** Called once per finished run, after the result is saved. */
  onComplete?: (result: GameResult) => void;
}) {
  const [mode, setMode] = useState<"menu" | "play" | "pause">("menu");
  /** A run is mounted: playing, paused, or parked behind the menu after leaving mid-run. */
  const [live, setLive] = useState(false);
  const [run, setRun] = useState(0);
  const [activeSpec, setActiveSpec] = useState<unknown>(spec);

  // localStorage is client-only: false on the server and the hydration pass, true after.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const save = mounted ? loadGameSave(packId, game) : null;

  const start = (fresh: boolean) => {
    const next = fresh ? spec : (loadGameSave(packId, game)?.spec ?? spec);
    writeGameSave(packId, game, { spec: next, status: "playing", savedAt: Date.now() });
    setActiveSpec(next);
    setRun((r) => r + 1);
    setLive(true);
    setMode("play");
  };

  const finished = (result: GameResult) => {
    writeGameSave(packId, game, { spec: activeSpec, status: "finished", result, savedAt: Date.now() });
    onComplete?.(result);
  };

  // The results screen's exit: that run is over, back to the game's menu.
  const backToMenu = () => {
    setLive(false);
    setMode("menu");
  };

  // Leave mid-run: the save stays "playing" (so Continue is offered after a reload too).
  const leave = () => {
    if (loadGameSave(packId, game)?.status === "playing") {
      writeGameSave(packId, game, { spec: activeSpec, status: "playing", savedAt: Date.now() });
    }
    setMode("menu");
    if (onExit) onExit();
    else if (exitHref) window.location.assign(exitHref);
  };

  // ESC pauses a run, and resumes it from the pause menu.
  useEffect(() => {
    if (!live || mode === "menu") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setMode((m) => (m === "play" ? "pause" : "play"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, mode]);

  return (
    <>
      {live && (
        <div className={`${styles.play} ${styles[game]}`} hidden={mode === "menu"} data-testid="game-play">
          <button className={styles.menuButton} onClick={() => setMode("pause")} aria-label="Menu" title="Menu (Esc)">
            <span aria-hidden>☰</span> Menu
          </button>
          <GamePlayer key={run} game={game} spec={activeSpec} title={packTitle} onComplete={finished} onExit={backToMenu} paused={mode !== "play"} />
          {mode === "pause" && (
            <div className={styles.pause} role="dialog" aria-modal="true" aria-label="Paused" data-testid="pause-menu">
              <div className={styles.pausePanel}>
                <p className={styles.brand}>Paused</p>
                <h2 className={styles.pauseTitle}>{packTitle}</h2>
                <nav className={styles.options} aria-label="Pause menu">
                  <MenuOption label="Resume" onClick={() => setMode("play")} autoFocus />
                  {(onExit || exitHref) && <MenuOption label="Leave the building" note="Your run is saved" onClick={leave} />}
                </nav>
              </div>
            </div>
          )}
        </div>
      )}
      {mode === "menu" && (
        <div className={`${styles.menu} ${styles[game]}`} data-testid="game-menu">
          {game === "dilemma" && (
            // eslint-disable-next-line @next/next/no-img-element -- bundled sprite art, not an optimised photo
            <img className={styles.menuBg} src={OFFICE_BG} alt="" aria-hidden />
          )}
          <div className={styles.menuInner}>
            <p className={styles.brand}>{GAME_BRAND[game]}</p>
            <h1 className={styles.courseTitle}>{packTitle}</h1>
            {game === "battle" && (
              // eslint-disable-next-line @next/next/no-img-element -- animated GIF sprite, served as-is
              <img
                className={styles.mascot}
                src={`${FRONT_SPRITE}/${(spec as { opponent?: { pokemon?: number } }).opponent?.pokemon ?? 25}.gif`}
                alt=""
                aria-hidden
              />
            )}
            <nav className={styles.options} aria-label="Game menu">
              {live && <MenuOption label="Continue" note="Pick up where you left off" onClick={() => setMode("play")} autoFocus />}
              <MenuOption label="New game" onClick={() => start(true)} />
              {!live && save && <MenuOption label="Continue" note={savedLine(save)} onClick={() => start(false)} />}
              {onExit && <MenuOption label="Leave the building" onClick={onExit} />}
              {!onExit && exitHref && (
                <a className={styles.option} href={exitHref}>
                  <span className={styles.optionCursor} aria-hidden>
                    ▶
                  </span>
                  Leave the building
                </a>
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
