import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { findGame } from "@/games/core/instantiate";
import { getLlm } from "@/llm";
import { generateGameForPack } from "@/services/games";
import type { GameId } from "@/games/core/types";
import { GameShell } from "@/games/core/GameShell";

export default async function GameSamplePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pack?: string; player?: string }>;
}) {
  const { id } = await params;
  const { pack: packId, player } = await searchParams;
  const game = findGame(id);
  if (!game) notFound();

  // ?pack=<course id> generates a fresh spec from the course's current content instead of the sample.
  let generated: { spec: unknown; packTitle: string; sectionsUsed: number } | null = null;
  let generateError: string | null = null;
  if (packId) {
    try {
      const result = await generateGameForPack(await getDb(), getLlm(), { packId, game: game.id as GameId, playerName: player });
      generated = { spec: result.spec, packTitle: result.packTitle, sectionsUsed: result.sectionsUsed };
    } catch (err) {
      generateError = err instanceof Error ? err.message : "Couldn't generate a game from that course";
    }
  }

  const playing = generated ?? { spec: game.sample, packTitle: null, sectionsUsed: 0 };
  const title = generated?.packTitle ?? (playing.spec as { title?: string }).title ?? game.name;
  return (
    <>
      {generateError && (
        <p role="alert" className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-900 shadow">
          {generateError} — showing the sample instead.
        </p>
      )}
      <GameShell
        game={game.id as GameId}
        spec={playing.spec}
        packId={packId ?? "sample"}
        packTitle={title}
        exitHref="/games"
      />
    </>
  );
}
