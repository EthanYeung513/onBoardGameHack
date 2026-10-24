import type { GameSpecDefinition } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
import { battleGame } from "./battle/spec";

// game:word-match import

// game:dilemma import

/** Every registered game's schema, sample and guidance. Server-safe: no React. */
export const catalog: GameSpecDefinition<unknown>[] = [
  battleGame as GameSpecDefinition<unknown>,

  // game:word-match entry

  // game:dilemma entry
];
