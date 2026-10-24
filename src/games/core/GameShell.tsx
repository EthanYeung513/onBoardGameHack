"use client";

import { useState, useSyncExternalStore } from "react";
import type { GameId, GameResult } from "./types";
import { GamePlayer } from "./GamePlayer";
import { loadGameSave, writeGameSave, type GameSave } from "./save";
import styles from "./GameShell.module.css";

const FRONT_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated";
const OFFICE_BG = "/games/ace-attorney/fey-co.-office-entrance.png";

/** The shell's own labels per game: the real game's name, and a mascot line for its menu. */
const GAME_BRAND: Record<GameId, string> = {
  battle: "a GymQuest battle",
  "word-match": "a GymQuest arcade",
  dilemma: "a GymQuest confrontation",
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

/**
 * The building's inside: the game's own full-screen main menu (course name, real assets and fonts),
 * then the game filling the page. Continue replays the exact spec the last run was saved with.
 */
export function GameShell({
  game,
  spec,
  packId,
  packTitle,
  exitHref,
}: {
  game: GameId;
  spec: unknown;
  packId: string;
  /** The course's name — shown as the menu title, never the minigame's name. */
  packTitle: string;
  exitHref?: string;
}) {
  const [mode, setMode] = useState<"menu" | "play">("menu");
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
    setMode("play");
  };

  const finished = (result: GameResult) => {
    writeGameSave(packId, game, { spec: activeSpec, status: "finished", result, savedAt: Date.now() });
  };

  const backToMenu = () => setMode("menu");

  if (mode === "play") {
    return (
      <div className={`${styles.play} ${styles[game]}`}>
        <GamePlayer
          game={game}
          spec={activeSpec}
          title={packTitle}
          onComplete={finished}
          onExit={backToMenu}
        />
      </div>
    );
  }

  return (
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
          <button className={styles.option} onClick={() => start(true)}>
            <span className={styles.optionCursor} aria-hidden>
              ▶
            </span>
            New game
          </button>
          {save && (
            <button className={styles.option} onClick={() => start(false)}>
              <span className={styles.optionCursor} aria-hidden>
                ▶
              </span>
              Continue
              <span className={styles.optionNote}>{savedLine(save)}</span>
            </button>
          )}
          {exitHref && (
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
  );
}
