import type { GameSpecDefinition } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
import { battleGame } from "./battle/spec";

import { wordMatchGame } from "./word-match/spec";

import { dilemmaGame } from "./dilemma/spec";

/** Every registered game's schema, sample and guidance. Server-safe: no React. */
export const catalog: GameSpecDefinition<unknown>[] = [
  battleGame as GameSpecDefinition<unknown>,

  wordMatchGame as GameSpecDefinition<unknown>,

  dilemmaGame as GameSpecDefinition<unknown>,
];
