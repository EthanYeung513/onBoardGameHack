"use client";

import { useEffect, useRef } from "react";
import { gameBus, setBuildingLabels, setLockedBuildings } from "@/game/events";
import type { Dir } from "@/game/logic";

/** Mounts the Phaser world on the client only (Phaser needs `window`), with an on-screen d-pad for touch. */
export function GameCanvas({ locked, labels }: { locked: string[]; labels: Record<string, string> }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: { destroy(removeCanvas: boolean): void } | undefined;
    let cancelled = false;
    (async () => {
      const Phaser = (await import("phaser")).default;
      const { WorldScene, WORLD_WIDTH, WORLD_HEIGHT } = await import("@/game/WorldScene");
      if (cancelled || !host.current) return;
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: host.current,
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        pixelArt: true,
        backgroundColor: "#2f3b2f",
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [WorldScene],
      });
    })();
    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  useEffect(() => setLockedBuildings(locked), [locked]);
  useEffect(() => setBuildingLabels(labels), [labels]);

  return (
    <div className="relative w-full">
      <div ref={host} className="aspect-[3/2] w-full overflow-hidden rounded-lg border-4 border-ink bg-[#2f3b2f]" data-testid="game-host" />
      <DPad />
    </div>
  );
}

function DPad() {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const start = (dir: Dir) => {
    stop();
    gameBus.emit("input:move", { dir });
    timer.current = setInterval(() => gameBus.emit("input:move", { dir }), 160);
  };
  useEffect(() => stop, []);

  const button = (dir: Dir, label: string, area: string) => (
    <button
      aria-label={`Move ${dir}`}
      onPointerDown={(e) => {
        e.preventDefault();
        start(dir);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className="h-12 w-12 touch-none select-none rounded-md bg-ink/80 text-xl text-paper active:bg-ink"
      style={{ gridArea: area }}
    >
      {label}
    </button>
  );

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 grid gap-1 opacity-80 md:hidden" style={{ gridTemplateAreas: '". u ." "l . r" ". d ."' }}>
      {button("up", "▲", "u")}
      {button("left", "◀", "l")}
      {button("right", "▶", "r")}
      {button("down", "▼", "d")}
    </div>
  );
}
