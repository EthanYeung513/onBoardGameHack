"use client";

import type { GameComponent, GameId } from "./core/types";

// Each game branch fills in its own placeholder line. The blank lines keep the branches mergeable.
import { BattleGame } from "./battle/BattleGame";

import { WordMatchGame } from "./word-match/WordMatchGame";

import { DilemmaGame } from "./dilemma/DilemmaGame";

/** The client component for each registered game. */
export const components: Partial<Record<GameId, GameComponent<unknown>>> = {
  battle: BattleGame as GameComponent<unknown>,

  "word-match": WordMatchGame as GameComponent<unknown>,

  dilemma: DilemmaGame as GameComponent<unknown>,
};
