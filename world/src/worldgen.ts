// World generation — the "how does the game lay out a town" layer.
// Everything an agent needs to customize the world lives here:
//   * BUILDINGS — asset database (sprite key -> footprint + door offset)
//   * PROPS — placeable scenery
//   * generateWorld() — builds a deterministic WorldSpec from a course list
//   * the tile index constants mirror tileset.png
import type { Course } from './config';

export const T = 16;
export const MAP_W = 60;
export const MAP_H = 40;

// ---------- tile indices in tileset.png (8 per row) ----------
export const G = 0, G_TUFT = 1, G_FLO_W = 2, G_FLO_Y = 3, DIRT = 4, WATER = 5, TILL = 7;
export const STONE = 8, WOOD = 9, DGRASS = 11;
export const ST_N = 16, ST_S = 17, ST_W = 18, ST_E = 19, PLAZA = 20;
// organic dirt autotile (grass-fringe edges, real SDV clearing tiles)
export const D_N = 24, D_S = 25, D_W = 26, D_E = 27;
export const D_NW = 28, D_NE = 29, D_SW = 30, D_SE = 31;
export const D_INT = [32, 33, 34]; // interior variants picked by hash

// ---------- asset database ----------
// w/h are the sprite's footprint in tiles (what blocks walking);
// an agent only ever references these keys, never pixel coordinates.
export const BUILDINGS: Record<string, { w: number; h: number }> = {
  b_townhall: { w: 6, h: 8 },   // Adventurer's Guild
  b_shop:     { w: 10, h: 9 },  // Pierre's
  b_saloon:   { w: 7, h: 8 },   // Stardrop Saloon
  b_clinic:   { w: 5, h: 8 },   // Harvey's clinic
  b_green:    { w: 5, h: 7 },   // green community building
  b_house:    { w: 6, h: 9 },   // blue cottage
  b_house2:   { w: 6, h: 9 },   // orange house
  b_trailer:  { w: 7, h: 3 },   // Pam's trailer
  // farm buildings, available for variety
  b_barn:     { w: 7, h: 8 },
  b_coop:     { w: 6, h: 8 },
  b_stable:   { w: 4, h: 6 },
  b_silo:     { w: 3, h: 8 },
  b_well:     { w: 3, h: 5 },
};
// cycle used when the dashboard doesn't specify a building per course
export const BUILDING_CYCLE = ['b_shop', 'b_saloon', 'b_clinic', 'b_green', 'b_house', 'b_house2', 'b_trailer'];

export interface BuildingSpec {
  key: string;
  course?: Course;
  x: number; y: number;      // tile pos (top-left)
  w: number; h: number;      // footprint
  doorX: number; doorY: number; // tile in front of the door
  townHall?: boolean;
}

export interface WorldSpec {
  seed: number;
  buildings: BuildingSpec[];
  paved: Set<string>;  // cobble tiles (main street + plaza)
  dirt: Set<string>;   // organic dirt path tiles
}

export const key2 = (x: number, y: number) => `${x},${y}`;

// ---------- deterministic rng ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A gently wandering 2-tall trail from the door to the street's edge.
// Runs horizontally (left buildings head east, right head west) with a
// slow wobble in y, clamped to a band so it can't hit other buildings.
function carveConnector(dirt: Set<string>, rnd: () => number,
  fromX: number, fromY: number, toX: number, bandLo: number, bandHi: number) {
  let y = fromY;
  const step = toX > fromX ? 1 : -1;
  let wander = 0; // walk bias so it feels like a footpath, not a sine wave
  for (let x = fromX; step > 0 ? x <= toX : x >= toX; x += step) {
    wander += rnd() < 0.35 ? (rnd() < 0.5 ? -1 : 1) : 0;
    wander = Math.max(-2, Math.min(2, wander));
    const yy = Math.max(bandLo, Math.min(bandHi, y + wander));
    dirt.add(key2(x, yy));
    dirt.add(key2(x, yy + 1));
    y = yy;
  }
  // make sure the door mouth itself is dirt
  dirt.add(key2(fromX, fromY));
  dirt.add(key2(fromX, fromY + 1));
}

export function generateWorld(courses: Course[], seed = 20261024): WorldSpec {
  const rnd = mulberry32(seed);
  const buildings: BuildingSpec[] = [];
  const paved = new Set<string>();
  const dirt = new Set<string>();

  // --- paved: vertical main street + plaza in front of the guild ---
  for (let y = 0; y < MAP_H; y++) { paved.add(key2(29, y)); paved.add(key2(30, y)); }
  for (let y = 8; y <= 9; y++) for (let x = 24; x <= 35; x++) paved.add(key2(x, y));

  // --- buildings ---
  buildings.push({ key: 'b_townhall', x: MAP_W / 2 - 3, y: 1, w: 6, h: 8, doorX: MAP_W / 2 - 1, doorY: 9, townHall: true });
  // course slots: two columns (left x=4, right edge ~56), rows y=2,14,26
  const rows = [2, 14, 26];
  const specs: BuildingSpec[] = courses.map((c, i) => {
    const left = i % 2 === 0;
    const row = rows[Math.floor(i / 2) % rows.length];
    const key = c.building ?? BUILDING_CYCLE[i % BUILDING_CYCLE.length];
    const sz = BUILDINGS[key] ?? { w: 6, h: 8 };
    const x = left ? 4 : MAP_W - 4 - sz.w;
    return { key, course: c, x, y: row, w: sz.w, h: sz.h,
      doorX: x + Math.floor(sz.w / 2), doorY: row + sz.h };
  });
  buildings.push(...specs);

  // --- winding dirt connectors: door -> main street ---
  const leftEdge = 29, rightEdge = 30;
  specs.forEach((b, i) => {
    const left = i % 2 === 0;
    // wander band: a few rows around the door, never into the next slot row
    const nextRow = rows[Math.floor(i / 2) % rows.length + 1] ?? MAP_H;
    const bandLo = Math.min(b.doorY, nextRow - 1);
    const bandHi = Math.min(b.doorY + 4, nextRow - 1, MAP_H - 3);
    if (left) carveConnector(dirt, rnd, b.doorX, b.doorY, leftEdge - 1, bandLo, bandHi);
    else carveConnector(dirt, rnd, b.doorX, b.doorY, rightEdge + 1, bandLo, bandHi);
  });

  return { seed, buildings, paved, dirt };
}
