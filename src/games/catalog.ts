import type { GameSpecDefinition } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
// game:battle import

import { wordMatchGame } from "./word-match/spec";

// game:dilemma import

/** Every registered game's schema, sample and guidance. Server-safe: no React. */
export const catalog: GameSpecDefinition<unknown>[] = [
  // game:battle entry

  wordMatchGame as GameSpecDefinition<unknown>,

  // game:dilemma entry
];
