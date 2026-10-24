"use client";

import type { GameComponent, GameId } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
import { BattleGame } from "./battle/BattleGame";

// game:word-match import

// game:dilemma import

/** The client component for each registered game. */
export const components: Partial<Record<GameId, GameComponent<unknown>>> = {
  battle: BattleGame as GameComponent<unknown>,

  // game:word-match entry

  // game:dilemma entry
};
