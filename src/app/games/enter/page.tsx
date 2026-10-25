import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { companyMetadata } from "@/brand";
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
 * The building's door: /games/enter?pack=<courseId>[&player=<name>][&exit=<url>].
 * The course's content picks the game style (battle, word-match or dilemma),
 * then we send them inside that building — one game per course per building.
 */
export default async function EnterBuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ pack?: string; player?: string; exit?: string }>;
}) {
  const { pack: packId, player, exit } = await searchParams;
  if (!packId) redirect("/games");

  const result = await generateGameForPack(await getDb(), getLlm(), { packId, playerName: player });

  const params = new URLSearchParams({ pack: packId });
  if (player) params.set("player", player);
  if (exit) params.set("exit", exit);
  redirect(`/games/play/${result.game}?${params.toString()}`);
}
