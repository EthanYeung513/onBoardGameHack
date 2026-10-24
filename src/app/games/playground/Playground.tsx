"use client";

import { useState } from "react";
import { catalog } from "@/games/catalog";
import { GamePlayer } from "@/games/core/GamePlayer";
import { instantiateGame } from "@/games/core/instantiate";
import type { GameId } from "@/games/core/types";

const sampleJson = (id: string) => {
  const g = catalog.find((c) => c.id === id);
  return g ? JSON.stringify({ game: g.id, spec: g.sample }, null, 2) : "";
};

/** Paste what the AI returned ({ game, spec }), validate it the same way the pipeline does, and play it. */
export function Playground() {
  const [text, setText] = useState(() => (catalog[0] ? sampleJson(catalog[0].id) : '{ "game": "", "spec": {} }'));
  const [errors, setErrors] = useState<string[]>([]);
  const [playing, setPlaying] = useState<{ game: GameId; spec: unknown; title: string } | null>(null);

  if (playing) {
    return (
      <div className="flex flex-col gap-3">
        <button onClick={() => setPlaying(null)} className="self-start text-sm underline">
          ← Back to the JSON
        </button>
        <GamePlayer game={playing.game} spec={playing.spec} title={playing.title} onExit={() => setPlaying(null)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>Load a sample:</span>
        {catalog.map((g) => (
          <button key={g.id} onClick={() => (setText(sampleJson(g.id)), setErrors([]))} className="rounded border-2 border-ink/30 px-2 py-1">
            {g.name}
          </button>
        ))}
        {catalog.length === 0 && <span className="text-ink/60">(no games installed on this branch)</span>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={22}
        spellCheck={false}
        aria-label="Game instance JSON"
        className="rounded-lg border-2 border-ink/30 bg-white p-3 font-mono text-xs"
      />
      <button
        onClick={() => {
          const result = instantiateGame(text);
          if (!result.ok) return setErrors(result.errors);
          setErrors([]);
          setPlaying({ game: result.game, spec: result.spec, title: (result.spec as { title?: string }).title ?? result.definition.name });
        }}
        className="self-start rounded bg-ink px-4 py-2 font-semibold text-paper"
      >
        Validate and play
      </button>
      {errors.length > 0 && (
        <ul className="rounded-lg bg-red-50 p-3 text-sm text-red-900" role="alert">
          {errors.map((e) => (
            <li key={e} className="font-mono">
              {e}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
