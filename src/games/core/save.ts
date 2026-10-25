import type { GameId, GameResult } from "./types";

/** A player's saved run for one course's game, kept in localStorage until results sync to the backend. */
export interface GameSave {
  /** The exact spec the run was generated with, so Continue replays identical content. */
  spec: unknown;
  status: "playing" | "finished";
  result?: GameResult;
  savedAt: number;
}

const key = (packId: string, game: GameId) => `og-save:${packId}:${game}`;

export function loadGameSave(packId: string, game: GameId): GameSave | null {
  try {
    const raw = localStorage.getItem(key(packId, game));
    return raw ? (JSON.parse(raw) as GameSave) : null;
  } catch {
    return null;
  }
}

export function writeGameSave(packId: string, game: GameId, save: GameSave): void {
  try {
    localStorage.setItem(key(packId, game), JSON.stringify(save));
  } catch {
    // Private mode / quota: play still works, Continue just won't be offered.
  }
}
