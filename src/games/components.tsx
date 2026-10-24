"use client";

import type { GameComponent, GameId } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
// game:battle import

import { WordMatchGame } from "./word-match/WordMatchGame";

// game:dilemma import

/** The client component for each registered game. */
export const components: Partial<Record<GameId, GameComponent<unknown>>> = {
  // game:battle entry

  "word-match": WordMatchGame as GameComponent<unknown>,

  // game:dilemma entry
};
