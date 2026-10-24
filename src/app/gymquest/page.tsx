import Link from "next/link";

export const metadata = { title: "GymQuest" };

export default function GymQuestHome() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-16">
      <h1 className="font-pixel text-2xl leading-relaxed">GymQuest</h1>
      <p className="text-lg">
        Onboarding for any role, played as a game. Hires answer real work situations; an AI grader scores them
        against company policy; every expert correction becomes a model update.
      </p>
      <div className="flex flex-wrap gap-4">
        <Link href="/play" className="rounded bg-ink px-5 py-3 font-semibold text-paper">
          Play as a new hire
        </Link>
        <Link href="/admin" className="rounded border-2 border-ink px-5 py-3 font-semibold">
          Manager console
        </Link>
      </div>
    </main>
  );
}
