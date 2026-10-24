import type { GameSpecDefinition } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
// game:battle import

// game:word-match import

import { dilemmaGame } from "./dilemma/spec";

/** Every registered game's schema, sample and guidance. Server-safe: no React. */
export const catalog: GameSpecDefinition<unknown>[] = [
  // game:battle entry

  // game:word-match entry

  dilemmaGame as GameSpecDefinition<unknown>,
];
