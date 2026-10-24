"use client";

import type { GameComponent, GameId } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
// game:battle import

// game:word-match import

import { DilemmaGame } from "./dilemma/DilemmaGame";

/** The client component for each registered game. */
export const components: Partial<Record<GameId, GameComponent<unknown>>> = {
  // game:battle entry

  // game:word-match entry

  dilemma: DilemmaGame as GameComponent<unknown>,
};
