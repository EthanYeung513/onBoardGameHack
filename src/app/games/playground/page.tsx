import Link from "next/link";
import { Playground } from "./Playground";

export const metadata = { title: "Game playground" };

export default function PlaygroundPage() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6">
      <nav className="text-sm">
        <Link href="/games" className="underline">
          ← Game library
        </Link>
      </nav>
      <h1 className="text-2xl font-bold">Playground</h1>
      <p className="text-ink/70">This is the exact shape the AI returns after picking a game. Edit it and press play: invalid specs show the errors the AI would get back.</p>
      <Playground />
    </main>
  );
}
