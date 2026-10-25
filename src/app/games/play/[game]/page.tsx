import type { Metadata } from "next";
import { getDb } from "@/db/client";
import { companyMetadata } from "@/brand";
import { findGame } from "@/games/core/instantiate";
import { GameShell } from "@/games/core/GameShell";
import type { GameId } from "@/games/core/types";
import { getLlm } from "@/llm";
import { companyForPack, generateGameForPack } from "@/services/games";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string }>;
}): Promise<Metadata> {
  const { pack } = await searchParams;
  const company = pack ? await companyForPack(await getDb(), pack).catch(() => null) : null;
  return companyMetadata(company);
}

/**
 * The inside of a Stardew building: /games/play/<game>?pack=<course id>[&player=<name>][&exit=<url>].
 * Generates the spec from the course's current content, shows that game's own full-screen menu
 * (course name, New game / Continue), then plays full-page. Sized for desktop and mobile.
 */
export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ game: string }>;
  searchParams: Promise<{ pack?: string; player?: string; exit?: string }>;
}) {
  const { game: id } = await params;
  const { pack: packId, player, exit } = await searchParams;
  const game = findGame(id);

  let error: string | null = null;
  let result: Awaited<ReturnType<typeof generateGameForPack>> | null = null;
  if (!game) error = `Unknown game "${id}".`;
  else if (!packId) error = "No course linked yet — this building needs a ?pack=<course id>.";
  else {
    try {
      result = await generateGameForPack(await getDb(), getLlm(), { packId, game: game.id as GameId, playerName: player });
    } catch (err) {
      error = err instanceof Error ? err.message : "Couldn't generate this course's game";
    }
  }

  if (result) {
    return <GameShell game={result.game} spec={result.spec} packId={result.packId} packTitle={result.packTitle} exitHref={exit} />;
  }

  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-3 bg-[#0a0f24] px-6 text-center text-white">
      <h1 className="font-pixel text-lg">Can&apos;t enter yet</h1>
      <p className="max-w-md">{error}</p>
      {exit && (
        <a href={exit} className="underline">
          ← Back outside
        </a>
      )}
    </main>
  );
}
