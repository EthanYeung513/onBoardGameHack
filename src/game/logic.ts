import { DOORS } from "./map";

export type TileKind = "wall" | "floor" | "path" | "grass" | "building" | "door";
export type Dir = "up" | "down" | "left" | "right";
export interface Pos {
  x: number;
  y: number;
}

export interface ParsedMap {
  width: number;
  height: number;
  tiles: TileKind[][];
  /** building id at each door tile, keyed "x,y" */
  doors: Map<string, string>;
  /** door position for each building id */
  doorOf: Record<string, Pos>;
}

const KIND: Record<string, TileKind> = { "#": "wall", ",": "floor", ".": "path", '"': "grass", B: "building" };

export function parseMap(rows: string[]): ParsedMap {
  const width = rows[0]?.length ?? 0;
  const doors = new Map<string, string>();
  const doorOf: Record<string, Pos> = {};
  const tiles = rows.map((row, y) => {
    if (row.length !== width) throw new Error(`Map row ${y} has width ${row.length}, expected ${width}`);
    return [...row].map((ch, x): TileKind => {
      if (DOORS[ch]) {
        doors.set(`${x},${y}`, DOORS[ch].building);
        doorOf[DOORS[ch].building] = { x, y };
        return "door";
      }
      const kind = KIND[ch];
      if (!kind) throw new Error(`Unknown map character "${ch}" at ${x},${y}`);
      return kind;
    });
  });
  return { width, height: rows.length, tiles, doors, doorOf };
}

export type StepEvent = { type: "enter:gym"; building: string } | { type: "locked"; building: string } | { type: "encounter:phish" };

export interface StepResult {
  pos: Pos;
  moved: boolean;
  event: StepEvent | null;
}

export const DELTA: Record<Dir, Pos> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
export const ENCOUNTER_RATE = 0.15;

export interface StepOptions {
  locked?: Set<string>;
  rng?: () => number;
  encounterRate?: number;
}

/**
 * One grid step. Walls and buildings block. Walking into a door stays put and enters the building (or reports it
 * locked). Each step into long grass may trigger a wild phishing encounter.
 */
export function step(map: ParsedMap, pos: Pos, dir: Dir, opts: StepOptions = {}): StepResult {
  const next = { x: pos.x + DELTA[dir].x, y: pos.y + DELTA[dir].y };
  const kind = map.tiles[next.y]?.[next.x];
  if (!kind || kind === "wall" || kind === "building") return { pos, moved: false, event: null };
  if (kind === "door") {
    const building = map.doors.get(`${next.x},${next.y}`)!;
    return { pos, moved: false, event: opts.locked?.has(building) ? { type: "locked", building } : { type: "enter:gym", building } };
  }
  const rng = opts.rng ?? Math.random;
  const encounter = kind === "grass" && rng() < (opts.encounterRate ?? ENCOUNTER_RATE);
  return { pos: next, moved: true, event: encounter ? { type: "encounter:phish" } : null };
}
