"use client";

import { GamePlayer } from "@/games/core/GamePlayer";
import type { GameId } from "@/games/core/types";

export function SampleGame({ game, spec, title }: { game: GameId; spec: unknown; title: string }) {
  return <GamePlayer game={game} spec={spec} title={title} />;
}
