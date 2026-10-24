import Link from "next/link";
import { notFound } from "next/navigation";
import { findGame } from "@/games/core/instantiate";
import { SampleGame } from "./SampleGame";

export default async function GameSamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = findGame(id);
  if (!game) notFound();
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/games" className="underline">
          ← Game library
        </Link>
        <span className="text-ink/60">Sample: {game.name}</span>
      </nav>
      <SampleGame game={game.id} spec={game.sample} title={(game.sample as { title?: string }).title ?? game.name} />
    </main>
  );
}
