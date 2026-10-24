import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { findGame } from "@/games/core/instantiate";
import { getLlm } from "@/llm";
import { generateGameForPack } from "@/services/games";
import type { GameId } from "@/games/core/types";
import { SampleGame } from "./SampleGame";

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
  const title = (playing.spec as { title?: string }).title ?? game.name;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/games" className="underline">
          ← Game library
        </Link>
        <span className="text-ink/60">
          {generated ? `Generated from “${generated.packTitle}” · ${generated.sectionsUsed} sections` : `Sample: ${game.name}`}
        </span>
      </nav>
      {generateError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {generateError} — showing the sample instead.
        </p>
      )}
      <SampleGame game={game.id} spec={playing.spec} title={title} />
    </main>
  );
}
