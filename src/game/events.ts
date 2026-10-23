import type { Dir } from "./logic";

/** Everything Phaser and React say to each other. Phaser never renders text screens; React never draws the map. */
export interface GameEvents {
  /** Phaser -> React */
  "enter:gym": { building: string };
  locked: { building: string };
  "encounter:phish": Record<string, never>;
  /** React -> Phaser */
  "input:move": { dir: Dir };
  "overlay:open": Record<string, never>;
  "overlay:close": Record<string, never>;
  "world:locked": { buildings: string[] };
  "world:labels": { labels: Record<string, string> };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, handler: Handler<E[K]>): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof E>(event: K, handler: Handler<E[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    for (const h of this.handlers.get(event) ?? []) (h as Handler<E[K]>)(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const gameBus = new EventBus<GameEvents>();

/** The latest world state React has sent, so a scene that starts later can catch up. */
export const worldState: { locked: string[]; labels: Record<string, string> } = { locked: [], labels: {} };

export function setLockedBuildings(buildings: string[]): void {
  worldState.locked = buildings;
  gameBus.emit("world:locked", { buildings });
}

/** Building id -> sign text, e.g. the annex showing the name of a newly uploaded gym. */
export function setBuildingLabels(labels: Record<string, string>): void {
  worldState.labels = labels;
  gameBus.emit("world:labels", { labels });
}
