"use client";

import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import type { PublicCard, WorldGym } from "@/services/world";
import { Battle } from "./Battle";
import { Creature } from "./Creature";

type Stage = "intro" | "trainers" | "boss-intro" | "boss" | "badge" | "lost";

/** A gym visit: trainer battle, then the Gym Leader (whose deck targets the hire's weak spots), then the badge. */
export function GymOverlay({ gym, learnerId, onClose }: { gym: WorldGym; learnerId: string; onClose: (badgeEarned: boolean) => void }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [cards, setCards] = useState<PublicCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Moves to a stage, clearing the previous deck so the next one loads fresh. */
  const go = (next: Stage) => {
    setCards(null);
    setError(null);
    setStage(next);
  };

  useEffect(() => {
    if (stage !== "trainers" && stage !== "boss") return;
    let cancelled = false;
    const kind = stage === "boss" ? "boss" : "trainer";
    getJson<{ cards: PublicCard[] }>(`/api/gyms/${gym.id}/deck?learnerId=${learnerId}&kind=${kind}`)
      .then(({ cards }) => {
        if (cancelled) return;
        if (kind === "trainer" && cards.length === 0) setStage("boss-intro");
        else setCards(cards);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [stage, attempt, gym.id, learnerId]);

  const claimBadge = async () => {
    try {
      await postJson("/api/badges", { learnerId, gymId: gym.id });
      go("badge");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const retry = (to: Stage) => {
    setAttempt((a) => a + 1);
    go(to);
  };

  return (
    <div className="flex flex-col gap-4">
      {stage === "intro" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <Creature kind={gym.building} size={120} />
          <h2 className="font-pixel text-base leading-relaxed">{gym.name}</h2>
          <p>
            {gym.leaderName} runs the <strong>{gym.packTitle}</strong> gym.{" "}
            {gym.cleared ? "You already hold this badge, but you can battle again." : "Beat the trainers, then the Gym Leader, to earn the badge."}
          </p>
          {!gym.forYou && <p className="text-sm text-ink/70">This gym is for another role. You can still train here.</p>}
          <div className="flex gap-2">
            <button onClick={() => go("trainers")} className="rounded bg-ink px-4 py-2 font-semibold text-paper">
              Battle the trainers
            </button>
            <button onClick={() => onClose(false)} className="rounded border-2 border-ink px-4 py-2 font-semibold">
              Leave
            </button>
          </div>
        </div>
      )}

      {(stage === "trainers" || stage === "boss") && !cards && !error && <p>Loading the battle…</p>}

      {stage === "trainers" && cards && cards.length > 0 && (
        <Battle
          key={`t${attempt}`}
          title={`${gym.name}: trainer battle`}
          foeName="Trainer"
          foeKind={gym.building}
          cards={cards}
          learnerId={learnerId}
          onFinish={(won) => go(won ? "boss-intro" : "lost")}
        />
      )}

      {stage === "boss-intro" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <Creature kind={gym.building} size={140} />
          <h2 className="font-pixel text-base leading-relaxed">{gym.leaderName} wants to battle!</h2>
          <p>The Gym Leader has studied your mistakes. Expect questions on the topics you found hardest.</p>
          <button onClick={() => go("boss")} className="rounded bg-accent px-4 py-2 font-semibold text-white">
            Face {gym.leaderName}
          </button>
        </div>
      )}

      {stage === "boss" && cards && cards.length > 0 && (
        <Battle
          key={`b${attempt}`}
          title={`${gym.name}: Gym Leader ${gym.leaderName}`}
          foeName={gym.leaderName}
          foeKind={gym.building}
          cards={cards}
          learnerId={learnerId}
          onFinish={(won) => (won ? claimBadge() : go("lost"))}
        />
      )}

      {stage === "lost" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-pixel text-sm leading-relaxed">Not this time.</p>
          <p>Read the cited policy in the feedback, then try again. You&apos;ll get different questions on the same skills.</p>
          <div className="flex gap-2">
            <button onClick={() => retry("trainers")} className="rounded bg-ink px-4 py-2 font-semibold text-paper">
              Try again
            </button>
            <button onClick={() => onClose(false)} className="rounded border-2 border-ink px-4 py-2 font-semibold">
              Leave
            </button>
          </div>
        </div>
      )}

      {stage === "badge" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="text-6xl" aria-hidden>
            🏅
          </span>
          <h2 className="font-pixel text-base leading-relaxed">{gym.name} badge earned!</h2>
          <p>It&apos;s on your skills passport. Your manager signs off before it counts for real access.</p>
          <button onClick={() => onClose(true)} className="rounded bg-ink px-4 py-2 font-semibold text-paper">
            Back to the office
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
