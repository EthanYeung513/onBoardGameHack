"use client";

import { useState } from "react";
import { components } from "../components";
import { GameResults } from "./GameResults";
import type { GameId, GameResult } from "./types";

/**
 * Mounts any registered game from its id and a validated spec, then shows the shared results screen.
 * This is all a caller needs once `instantiateGame` has accepted the AI's output.
 */
export function GamePlayer({
  game,
  spec,
  title,
  onComplete,
  onExit,
  instant,
}: {
  game: GameId;
  spec: unknown;
  title: string;
  onComplete?: (result: GameResult) => void;
  onExit?: () => void;
  instant?: boolean;
}) {
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<GameResult | null>(null);
  const Game = components[game];

  if (!Game) return <p className="text-red-700">Game &quot;{game}&quot; isn&apos;t installed on this branch.</p>;
  if (result) {
    return (
      <GameResults
        title={title}
        result={result}
        onReplay={() => {
          setResult(null);
          setRound((r) => r + 1);
        }}
        onExit={onExit}
      />
    );
  }
  return (
    <Game
      key={round}
      spec={spec}
      instant={instant}
      onComplete={(r) => {
        setResult(r);
        onComplete?.(r);
      }}
    />
  );
}
