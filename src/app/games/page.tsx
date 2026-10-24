import Link from "next/link";
import { catalog } from "@/games/catalog";

export const metadata = { title: "Games · GymQuest" };

export default function GamesPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <Link href="/" className="font-pixel text-xs">
          GymQuest
        </Link>
        <h1 className="mt-2 text-3xl font-bold">Game library</h1>
        <p className="text-ink/70">
          Each game renders from a JSON spec, so the AI only has to pick a game and fill in its schema. Try a sample, or paste a spec into the{" "}
          <Link href="/games/playground" className="underline">
            playground
          </Link>
          .
        </p>
      </div>
      {catalog.length === 0 && <p className="text-ink/70">No games are installed on this branch yet.</p>}
      <ul className="grid gap-4 sm:grid-cols-2">
        {catalog.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 rounded-xl border-2 border-ink/15 bg-white p-4">
            <h2 className="text-xl font-bold">{g.name}</h2>
            <p>{g.description}</p>
            <p className="text-sm text-ink/70">
              <span className="font-semibold">Best for:</span> {g.bestFor}
            </p>
            <Link href={`/games/${g.id}`} className="mt-auto self-start rounded bg-ink px-4 py-2 font-semibold text-paper">
              Play the sample
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
