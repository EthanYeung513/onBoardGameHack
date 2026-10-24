// World generation — the "how does the game lay out a town" layer.
//
// This file is the AGENT-FACING API. Everything needed to change what the
// world looks like lives here; the renderer (game/TownScene.ts) only draws
// what generateWorld() returns and never decides layout itself.
//
//   * BUILDINGS   — building asset DB (sprite key -> footprint + door column)
//   * PROPS       — scenery asset DB (trees, bushes, debris, crops, fences…)
//                   each prop is a source rect on a real Stardew sheet
//   * LOT_THEMES  — named decorators for the yard next to a course building
//                   ("paddock", "crops", "orchard", "wild", "garden").
//                   Register a new function here to add a new kind of lot.
//   * Builder     — the toolkit themes use: terrain painting, blobs, winding
//                   paths, fences with gates, lakes, cliffs, forests, scatter.
//   * generateWorld(courses, seed, opts) -> WorldSpec (deterministic per seed)
//
// Layout (top -> bottom): forest edge, raised plateau with the town hall,
// plaza + fountain; a cliff wall with stairs; the cobbled main street with
// one fenced/cluttered farm lot per course on alternating sides; then a
// lake + big crop field; forest all around. Map height grows with course count.
import type { Course } from './config';
import { TILE, type TileName } from './tiles.gen';

export { TILE };
export const T = 16;

// ---------- deterministic rng ----------
export type Rng = () => number;
export function mulberry32(a: number): Rng {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) >>> 0;

// ---------- building asset database ----------
// w/h: sprite size in tiles (also the hover box). solidH: how many bottom
// rows block walking (the roof above is walk-behind). door: tile column of
// the door inside the sprite; the door tile is the one just below it.
export interface BuildingDef { w: number; h: number; door: number; solidH?: number }
export const BUILDINGS: Record<string, BuildingDef> = {
  b_townhall:   { w: 13, h: 10, door: 6, solidH: 6 },  // Pelican Town community center
  b_shop:       { w: 9, h: 9, door: 5 },               // Pierre's General Store
  b_saloon:     { w: 7, h: 9, door: 5 },               // Stardrop Saloon
  b_clinic:     { w: 6, h: 9, door: 3 },               // Harvey's clinic
  b_green:      { w: 9, h: 8, door: 2 },               // green cottage w/ porch
  b_house2:     { w: 8, h: 9, door: 2 },               // orange duplex
  b_house3:     { w: 8, h: 10, door: 2 },              // grey-blue house
  b_house4:     { w: 10, h: 12, door: 4 },             // big two-storey house
  b_trailer:    { w: 8, h: 4, door: 3, solidH: 3 },    // Pam's trailer
  b_smithy:     { w: 7, h: 8, door: 3 },               // blacksmith
  b_farmhouse:  { w: 10, h: 9, door: 6, solidH: 5 },
  b_farmhouse2: { w: 10, h: 9, door: 6, solidH: 5 },
  b_shed:       { w: 7, h: 8, door: 3 },
  b_greenhouse: { w: 7, h: 10, door: 3 },
  // farm buildings (decoration in lots; usable as course buildings too)
  b_barn:       { w: 7, h: 7, door: 1, solidH: 4 },
  b_coop:       { w: 6, h: 7, door: 1, solidH: 4 },
  b_stable:     { w: 4, h: 6, door: 2, solidH: 3 },
  b_silo:       { w: 3, h: 8, door: 1, solidH: 3 },
  b_well:       { w: 3, h: 5, door: 1, solidH: 2 },
};
// cycle used when a course doesn't name its building
export const BUILDING_CYCLE = ['b_shop', 'b_saloon', 'b_clinic', 'b_green', 'b_house3', 'b_house2', 'b_farmhouse', 'b_house4', 'b_trailer', 'b_smithy', 'b_shed'];

// ---------- prop asset database ----------
// Placed at a "base" tile (x,y): footprint covers x..x+fw-1, y-fh+1..y.
// Sprite is bottom-aligned on the footprint and centred horizontally
// (+ox/oy nudge). flat = baked into the ground decal layer (no y-sorting).
export interface PropDef {
  tex: string; rect: [number, number, number, number];
  fw?: number; fh?: number; solid?: boolean; flat?: boolean; ox?: number; oy?: number;
}
const obj = (i: number, extra: Partial<PropDef> = {}): PropDef =>
  ({ tex: 'objects', rect: [(i % 24) * 16, Math.floor(i / 24) * 16, 16, 16], flat: true, ...extra });
const big = (i: number): PropDef =>
  ({ tex: 'objects', rect: [(i % 24) * 16, Math.floor(i / 24) * 16, 32, 32], fw: 2, fh: 2, solid: true });
const crop = (x: number, y: number): PropDef => ({ tex: 'crops', rect: [x, y, 16, 32], oy: -3 });
const craft = (i: number): PropDef =>
  ({ tex: 'craftables', rect: [(i % 8) * 16, Math.floor(i / 8) * 32, 16, 32], solid: true });

export const PROPS: Record<string, PropDef> = {
  // trees (trunk tile blocks)
  tree_oak:     { tex: 'tree_oak', rect: [0, 0, 48, 96], solid: true },
  tree_maple:   { tex: 'tree_maple', rect: [0, 0, 48, 96], solid: true },
  tree_pine:    { tex: 'tree_pine', rect: [0, 0, 48, 96], solid: true },
  tree_big:     { tex: 'tree_big', rect: [0, 0, 64, 96], fw: 2, solid: true },
  tree_blossom: { tex: 'tree_blossom', rect: [0, 0, 80, 96], fw: 2, solid: true },
  tree_cherry:  { tex: 'fruittrees', rect: [192, 0, 48, 80], solid: true },
  tree_apple:   { tex: 'fruittrees', rect: [240, 400, 48, 80], solid: true },
  tree_orange:  { tex: 'fruittrees', rect: [240, 160, 48, 80], solid: true },
  // bushes (Bush.cs spring source rects)
  bush_s:       { tex: 'bushes', rect: [0, 224, 16, 32], solid: true },
  bush_s2:      { tex: 'bushes', rect: [16, 224, 16, 32], solid: true },
  bush_m:       { tex: 'bushes', rect: [0, 0, 32, 48], fw: 2, solid: true },
  bush_berry:   { tex: 'bushes', rect: [32, 0, 32, 48], fw: 2, solid: true },
  bush_l:       { tex: 'bushes', rect: [0, 128, 48, 48], fw: 3, solid: true },
  tallgrass0:   { tex: 'tallgrass', rect: [0, 0, 24, 28], flat: true, oy: 4 },
  tallgrass1:   { tex: 'tallgrass', rect: [24, 0, 24, 28], flat: true, oy: 4 },
  tallgrass2:   { tex: 'tallgrass', rect: [48, 0, 24, 28], flat: true, oy: 4 },
  // debris & forage (springobjects indices, as in the game)
  weed0: obj(674), weed1: obj(675), weed2: obj(676), weed3: obj(677),
  weed4: obj(784), weed5: obj(313), weed6: obj(314),
  stone0: obj(343), stone1: obj(450), stone2: obj(668), stone3: obj(670),
  twig0: obj(294), twig1: obj(295),
  forage0: obj(16), forage1: obj(18), forage2: obj(20), forage3: obj(22),
  stump: big(600), log: big(602), boulder: big(672),
  // crops (mature frames on crops.png)
  crop_cauli: crop(96, 32), crop_parsnip: crop(80, 0), crop_kale: crop(208, 32),
  crop_tomato: crop(96, 128), crop_blueberry: crop(224, 128), crop_wheat: crop(208, 160),
  crop_corn: crop(224, 224), crop_pumpkin: crop(96, 288), crop_melon: crop(224, 96),
  // craftables & town furniture
  scarecrow: craft(8), beehouse: craft(10), keg: craft(12), jar: craft(15),
  chest: { tex: 'craftables', rect: [32, 512, 16, 32], solid: true },
  lamp: { tex: 'lamp', rect: [0, 0, 16, 64], solid: true },
  bench: { tex: 'bench', rect: [0, 0, 32, 32], fw: 2, solid: true },
  fountain: { tex: 'fountain', rect: [0, 0, 80, 80], fw: 5, fh: 3, solid: true },
  flowerpot: { tex: 'town', rect: [384, 16, 16, 32], solid: true },
  sign: { tex: 'sign', rect: [0, 0, 16, 32], solid: true },
  mailbox: { tex: 'mailbox', rect: [0, 0, 16, 32], solid: true },
};
// Fence1.png: 16x32 pieces chosen from neighbours (Fence.fenceDrawGuide)
const FENCE_GUIDE: Record<number, number> = {
  0: 5, 10: 9, 100: 10, 1000: 3, 500: 5, 1010: 8, 1100: 6, 1500: 3, 600: 0,
  510: 2, 110: 7, 1600: 0, 1610: 4, 1510: 2, 1110: 7, 610: 4,
};

// ---------- terrain ----------
export const Ter = { Grass: 0, Dirt: 1, Paved: 2, Water: 3, Tilled: 4, Cliff: 5, Forest: 6 } as const;
export type Ter = typeof Ter[keyof typeof Ter];

export interface BuildingSpec {
  key: string;
  course?: Course;
  x: number; y: number;          // tile pos (top-left of sprite)
  w: number; h: number;          // sprite size in tiles (hover box)
  doorX: number; doorY: number;  // tile in front of the door
  townHall?: boolean;
}
export interface PlacedProp {
  key: string; x: number; y: number;      // base tile
  px: number; py: number;                 // sprite top-left in world px
  tex: string; rect: [number, number, number, number];
  depth: number; flat: boolean;
}
export interface Lot { side: 'L' | 'R'; x0: number; y0: number; x1: number; y1: number; theme: string; building: BuildingSpec }
export interface WorldSpec {
  seed: number;
  w: number; h: number;
  ground: Int16Array;        // tileset frame per cell (row-major)
  blocked: Uint8Array;       // 1 = impassable
  buildings: BuildingSpec[];
  props: PlacedProp[];
  lots: Lot[];
  spawn: { x: number; y: number };        // tile
  npcHomes: { x: number; y: number }[];   // tiles
}
export interface WorldOptions {
  clutter?: number;        // debris density multiplier (1 = default)
  forestDepth?: number;    // tiles of forest at the map edges
  lake?: boolean;          // bottom lake
  themes?: string[];       // lot theme order (cycled); default: shuffled LOT_THEMES
}

export const key2 = (x: number, y: number) => `${x},${y}`;

// ======================================================================
// Builder — the toolkit. Themes and the layout use only these methods.
// ======================================================================
export class Builder {
  readonly ter: Uint8Array;
  readonly occ: Uint8Array;       // 0 free, 1 reserved walkway, 2 taken
  readonly hard: Uint8Array;      // permanent blockers (buildings, water, cliffs)
  readonly over: Int16Array;      // explicit tile override (cliffs, stairs), -1 = auto
  readonly solidBy: Int32Array;   // prop index blocking this cell, -1 none
  readonly props: (PlacedProp | null)[] = [];
  readonly fences = new Map<number, { gate: boolean }>();
  readonly buildings: BuildingSpec[] = [];

  constructor(readonly w: number, readonly h: number, readonly rnd: Rng) {
    const n = w * h;
    this.ter = new Uint8Array(n); this.occ = new Uint8Array(n); this.hard = new Uint8Array(n);
    this.over = new Int16Array(n).fill(-1); this.solidBy = new Int32Array(n).fill(-1);
  }

  // --- basics ---
  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  i(x: number, y: number) { return y * this.w + x; }
  t(x: number, y: number): Ter { return (this.inb(x, y) ? this.ter[this.i(x, y)] : Ter.Forest) as Ter; }
  set(x: number, y: number, t: Ter) { if (this.inb(x, y) && !this.hard[this.i(x, y)]) this.ter[this.i(x, y)] = t; }
  fill(x0: number, y0: number, x1: number, y1: number, t: Ter) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, t);
  }
  reserve(x: number, y: number) { if (this.inb(x, y) && this.occ[this.i(x, y)] === 0) this.occ[this.i(x, y)] = 1; }
  reserveRect(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.reserve(x, y);
  }
  free(x: number, y: number) { return this.inb(x, y) && this.occ[this.i(x, y)] === 0 && !this.hard[this.i(x, y)]; }
  rint(a: number, b: number) { return a + Math.floor(this.rnd() * (b - a + 1)); }
  pick<X>(a: readonly X[]): X { return a[Math.floor(this.rnd() * a.length)]; }
  chance(p: number) { return this.rnd() < p; }

  // --- props ---
  /** Place a prop if its footprint is free (and on allowed terrain). */
  place(key: string, x: number, y: number, o: { on?: Ter[]; force?: boolean; rect?: PlacedProp['rect']; dx?: number } = {}): boolean {
    const d = PROPS[key];
    if (!d) throw new Error(`unknown prop ${key}`);
    const fw = d.fw ?? 1, fh = d.fh ?? 1;
    for (let yy = y - fh + 1; yy <= y; yy++) for (let xx = x; xx < x + fw; xx++) {
      if (!this.inb(xx, yy)) return false;
      if (!o.force && !this.free(xx, yy)) return false;
      if (o.on && !o.on.includes(this.t(xx, yy))) return false;
    }
    const rect = o.rect ?? d.rect;
    const px = x * T + (fw * T - rect[2]) / 2 + (d.ox ?? 0) + (o.dx ?? 0);
    const py = (y + 1) * T - rect[3] + (d.oy ?? 0);
    const idx = this.props.length;
    this.props.push({ key, x, y, px, py, tex: d.tex, rect, depth: (y + 1) * T - 1, flat: !!d.flat });
    for (let yy = y - fh + 1; yy <= y; yy++) for (let xx = x; xx < x + fw; xx++) {
      const c = this.i(xx, yy);
      if (!d.flat || d.solid) this.occ[c] = 2;
      if (d.solid) this.solidBy[c] = idx;
    }
    return true;
  }
  removePropAt(x: number, y: number) {
    const c = this.i(x, y), pi = this.solidBy[c];
    if (pi < 0) return;
    const p = this.props[pi]!;
    const d = PROPS[p.key];
    for (let yy = p.y - (d.fh ?? 1) + 1; yy <= p.y; yy++) for (let xx = p.x; xx < p.x + (d.fw ?? 1); xx++) {
      this.solidBy[this.i(xx, yy)] = -1; this.occ[this.i(xx, yy)] = 1;
    }
    this.props[pi] = null;
  }

  // --- buildings ---
  building(key: string, x: number, y: number, course?: Course, townHall = false): BuildingSpec {
    const d = BUILDINGS[key] ?? { w: 6, h: 8, door: 3 };
    const b: BuildingSpec = { key, course, x, y, w: d.w, h: d.h, doorX: x + d.door, doorY: y + d.h, townHall };
    const sh = d.solidH ?? Math.ceil(d.h * 0.6);
    for (let yy = y; yy < y + d.h; yy++) for (let xx = x; xx < x + d.w; xx++) {
      if (!this.inb(xx, yy)) continue;
      const c = this.i(xx, yy);
      if (yy >= y + d.h - sh) this.hard[c] = 1;
      this.occ[c] = 2;  // keep scenery out from behind roofs too
    }
    this.reserveRect(b.doorX - 1, b.doorY, b.doorX + 1, b.doorY + 1);
    this.buildings.push(b);
    return b;
  }

  // --- fences ---
  fence(x: number, y: number, gate = false) {
    if (!this.inb(x, y) || this.hard[this.i(x, y)]) return;
    if (this.occ[this.i(x, y)] === 1 && !gate) gate = true; // never wall off a walkway
    this.fences.set(this.i(x, y), { gate });
    this.occ[this.i(x, y)] = 2;
  }
  /** Rectangle of fence with gates at the given tiles (must lie on the top/bottom edges). */
  fenceRect(x0: number, y0: number, x1: number, y1: number, gates: [number, number][] = [], skipTop = false) {
    const g = new Set(gates.map(([x, y]) => this.i(x, y)));
    for (let x = x0; x <= x1; x++) {
      if (!skipTop) this.fence(x, y0, g.has(this.i(x, y0)));
      this.fence(x, y1, g.has(this.i(x, y1)));
    }
    for (let y = y0 + 1; y < y1; y++) { this.fence(x0, y); this.fence(x1, y); }
  }

  // --- terrain shapes ---
  /** Noisy ellipse of terrain t. Returns painted cells. */
  blob(cx: number, cy: number, rx: number, ry: number, t: Ter, noise = 0.25, bounds?: [number, number, number, number]): number[] {
    const out: number[] = [];
    const ph = this.rnd() * 6.28, ph2 = this.rnd() * 6.28;
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      if (!this.inb(x, y)) continue;
      if (bounds && (x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3])) continue;
      const a = Math.atan2(y - cy, x - cx);
      const r = 1 + noise * (Math.sin(a * 3 + ph) * 0.6 + Math.sin(a * 5 + ph2) * 0.4);
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= r * r) { this.set(x, y, t); out.push(this.i(x, y)); }
    }
    return out;
  }
  /** Winding 2-wide trail from (x,y) horizontally to column toX, wobbling in [lo,hi]. */
  trail(x: number, y: number, toX: number, lo: number, hi: number, t: Ter = Ter.Dirt) {
    const step = toX > x ? 1 : -1;
    let yy = y, run = 0;
    for (let xx = x; step > 0 ? xx <= toX : xx >= toX; xx += step) {
      let ny = yy;
      if (run > 2 && this.chance(0.3)) { ny = Math.max(lo, Math.min(hi, yy + (this.chance(0.5) ? -1 : 1))); run = 0; }
      run++;
      for (let k = Math.min(yy, ny); k <= Math.max(yy, ny) + 1; k++) { this.set(xx, k, t); this.reserve(xx, k); }
      // widen the step column so the autotile never sees a 1-wide diagonal
      if (ny !== yy) for (let k = Math.min(yy, ny); k <= Math.max(yy, ny) + 1; k++) { this.set(xx - step, k, t); this.reserve(xx - step, k); }
      yy = ny;
    }
    return yy;
  }
  /** Vertical 2-wide trail from (x,y) down/up to row toY. */
  trailV(x: number, y: number, toY: number, t: Ter = Ter.Dirt) {
    const s = toY > y ? 1 : -1;
    for (let yy = y; s > 0 ? yy <= toY : yy >= toY; yy += s) for (const xx of [x, x + 1]) { this.set(xx, yy, t); this.reserve(xx, yy); }
  }
  /** Make every cell of terrain t part of a 2x2 block (keeps autotiles clean). */
  thicken(t: Ter, x0 = 0, y0 = 0, x1 = this.w - 1, y1 = this.h - 1) {
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (this.t(x, y) !== t) continue;
        const ok = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([ox, oy]) =>
          this.t(x + ox, y + oy) === t && this.t(x + ox + 1, y + oy) === t && this.t(x + ox, y + oy + 1) === t && this.t(x + ox + 1, y + oy + 1) === t);
        if (ok) continue;
        // grow toward the side with more same-terrain neighbours
        const dx = this.t(x + 1, y) === t || this.t(x - 1, y) !== t ? 1 : -1;
        const dy = this.t(x, y + 1) === t || this.t(x, y - 1) !== t ? 1 : -1;
        for (const [ax, ay] of [[x + dx, y], [x, y + dy], [x + dx, y + dy]]) {
          if (this.inb(ax, ay) && !this.hard[this.i(ax, ay)] && this.occ[this.i(ax, ay)] !== 2 && this.t(ax, ay) !== Ter.Water && this.t(ax, ay) !== Ter.Cliff) {
            this.set(ax, ay, t); changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  // --- features ---
  /** Lake: noisy blob of water, smoothed, with sandy shore autotile. */
  lake(cx: number, cy: number, rx: number, ry: number) {
    const cells = this.blob(cx, cy, rx, ry, Ter.Water, rx < 7 ? 0.1 : 0.18);
    // smooth: drop spurs, fill notches
    for (let pass = 0; pass < 2; pass++) for (const c of cells) {
      const x = c % this.w, y = (c / this.w) | 0;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([ox, oy]) => this.t(x + ox, y + oy) === Ter.Water).length;
      if (n <= 1) this.ter[c] = Ter.Grass;
    }
    // fill notches (cells with 3+ water neighbours) so the shoreline stays convex-ish
    for (let pass = 0; pass < 3; pass++)
      for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        if (!this.inb(x, y) || this.t(x, y) === Ter.Water || this.hard[this.i(x, y)] || this.occ[this.i(x, y)]) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([ox, oy]) => this.t(x + ox, y + oy) === Ter.Water).length;
        if (n >= 3) this.ter[this.i(x, y)] = Ter.Water;
      }
    this.thicken(Ter.Water, cx - rx - 2, cy - ry - 2, cx + rx + 2, cy + ry + 2);
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      if (this.t(x, y) === Ter.Water && this.inb(x, y)) { this.hard[this.i(x, y)] = 1; this.occ[this.i(x, y)] = 2; }
    }
    // sandy bank one tile around the water (shore tiles are sand-coloured)
    for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      if (this.t(x, y) !== Ter.Grass) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([ox, oy]) => this.t(x + ox, y + oy) === Ter.Water);
      if (near) this.set(x, y, Ter.Dirt);
    }
  }
  /**
   * South-facing cliff wall from x0..x1 whose lip is on row y (4 rows tall:
   * lip, face, face, base). gaps = columns that become wooden stairs.
   */
  cliff(x0: number, x1: number, y: number, stairs: number[] = []) {
    const st = new Set(stairs);
    for (let x = x0; x <= x1; x++) {
      for (let r = 0; r < 4; r++) {
        if (!this.inb(x, y + r)) continue;
        const c = this.i(x, y + r);
        if (st.has(x)) {
          this.over[c] = TILE[(['STAIR0', 'STAIR1', 'STAIR1', 'STAIR2'] as TileName[])[r]];
          this.ter[c] = Ter.Paved; this.occ[c] = 1;
          continue;
        }
        const left = x === x0 || st.has(x - 1), right = x === x1 || st.has(x + 1);
        let name: TileName;
        if (left) name = (`CL_LEND${r}`) as TileName;
        else if (right) name = (`CL_REND${r}`) as TileName;
        else name = ((['CL_LIP', 'CL_F', 'CL_G', 'CL_B'][r]) + (x % 2)) as TileName;
        this.over[c] = TILE[name];
        this.ter[c] = Ter.Cliff; this.hard[c] = 1; this.occ[c] = 2;
      }
    }
  }
  /** Dense edge forest over a rectangle: overlapping trees, shade underneath. */
  forest(x0: number, y0: number, x1: number, y1: number, kinds = ['tree_oak', 'tree_maple', 'tree_pine', 'tree_oak']) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.free(x, y)) this.set(x, y, Ter.Forest);
    for (let y = y1; y >= y0; y--) for (let x = x0; x <= x1; x++) {
      if (((x + y * 3 + (hash2(x, y) % 2)) % 2) !== 0) continue;
      this.place(this.pick(kinds), x, y);
    }
    // trees just past the bottom/top map edge so the border reads as canopy, not trunks
    if (y1 === this.h - 1 && x1 - x0 > 8) for (let x = x0; x <= x1; x += 2) {
      const k = this.pick(kinds), d = PROPS[k];
      for (const y of [this.h, this.h + 1]) {
        const xx = x + (y & 1);
        this.props.push({ key: k, x: xx, y, px: xx * T + (T - d.rect[2]) / 2, py: (y + 1) * T - d.rect[3], tex: d.tex, rect: d.rect, depth: (y + 1) * T - 1, flat: false });
      }
    }
    // seal: forest is impassable even between trunks
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (this.t(x, y) === Ter.Forest) { this.hard[this.i(x, y)] = 1; if (this.occ[this.i(x, y)] === 0) this.occ[this.i(x, y)] = 2; }
  }
  /** A cluster of n trees/bushes around (cx,cy). */
  grove(cx: number, cy: number, n: number, kinds = ['tree_oak', 'tree_maple', 'tree_pine'], spread = 3) {
    let placed = 0;
    for (let k = 0; k < n * 6 && placed < n; k++) {
      const x = cx + this.rint(-spread, spread), y = cy + this.rint(-spread, spread);
      if (this.place(this.pick(kinds), x, y, { on: [Ter.Grass, Ter.Forest] })) {
        placed++;
        // tuck a bush or tall grass at the foot of some trees
        if (this.chance(0.4)) this.place(this.pick(['bush_s', 'tallgrass0', 'tallgrass1', 'tallgrass2']), x + this.pick([-1, 1]), y + 1, { on: [Ter.Grass] });
      }
    }
  }
  /** Scatter weighted prop keys over a rect on matching terrain. */
  scatter(keys: string[], x0: number, y0: number, x1: number, y1: number, density: number, on: Ter[]) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
      if (this.chance(density)) this.place(this.pick(keys), x, y, { on });
  }
  /** Patches of tall grass (SDV's mottled meadow look). */
  meadow(x0: number, y0: number, x1: number, y1: number, patches: number) {
    for (let k = 0; k < patches; k++) {
      const cx = this.rint(x0, x1), cy = this.rint(y0, y1), r = this.rint(1, 3);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++)
        if ((x - cx) ** 2 / ((r + 1) ** 2) + (y - cy) ** 2 / (r * r) <= 1 && this.chance(0.75))
          this.place(this.pick(['tallgrass0', 'tallgrass1', 'tallgrass2']), x, y, { on: [Ter.Grass] });
    }
  }
  /** Tilled field with a crop per tile (one crop kind per row). */
  field(x0: number, y0: number, x1: number, y1: number, crops: string[]) {
    for (let y = y0; y <= y1; y++) {
      const c = this.pick(crops);
      for (let x = x0; x <= x1; x++) {
        if (!this.free(x, y)) continue;
        this.set(x, y, Ter.Tilled);
        if (this.chance(0.92)) this.place(c, x, y);
      }
    }
  }
}

// ---------- clutter recipes ----------
const DEBRIS = ['weed0', 'weed1', 'weed2', 'weed3', 'weed4', 'weed5', 'weed6', 'stone0', 'stone1', 'stone0', 'twig0', 'twig1', 'twig0'];
const GRASS_BITS = ['weed4', 'weed5', 'weed6', 'forage0', 'forage1', 'forage3', 'stone0', 'twig1'];
const CROPS = ['crop_cauli', 'crop_parsnip', 'crop_kale', 'crop_tomato', 'crop_blueberry', 'crop_wheat', 'crop_corn', 'crop_pumpkin', 'crop_melon'];

// ======================================================================
// LOT_THEMES — what fills the yard beside a course building. Each gets the
// free rectangle (fx0..fx1, fy0..fy1) next to the building, away from the
// path. Add your own: LOT_THEMES.myTheme = (b, r, lot) => { ... }
// ======================================================================
export type LotRect = { x0: number; y0: number; x1: number; y1: number; side: 'L' | 'R' };
export const LOT_THEMES: Record<string, (b: Builder, r: LotRect, clutter: number) => void> = {
  // fenced animal pen: dirt floor, debris, a farm building, gate on the path side
  paddock(b, r, clutter) {
    const w = Math.min(r.x1 - r.x0, b.rint(8, 11)), h = Math.min(r.y1 - r.y0, b.rint(5, 7));
    if (w < 5 || h < 4) return LOT_THEMES.wild(b, r, clutter);
    const x0 = r.side === 'L' ? r.x1 - w : r.x0, y0 = r.y1 - h, x1 = x0 + w, y1 = r.y1;
    b.blob((x0 + x1) / 2, (y0 + y1) / 2 + 0.5, w / 2 + 0.5, h / 2 + 0.5, Ter.Dirt, 0.15, [x0, y0 + 1, x1, y1]);
    const gx = r.side === 'L' ? x0 + 2 : x1 - 3;
    b.fenceRect(x0, y0, x1, y1, [[gx, y1], [gx + 1, y1]]);
    b.reserve(gx, y1 + 1); b.reserve(gx + 1, y1 + 1);
    const farm = b.pick(['b_coop', 'b_stable', 'b_silo', 'b_well']);
    const fd = BUILDINGS[farm];
    if (fd.w < w - 2 && fd.h < h + 3) {
      const bx = r.side === 'L' ? x1 - fd.w - 1 : x0 + 1, by = y0 + 1 - Math.max(0, fd.h - 3);
      let ok = true;
      for (let y = by; y < by + fd.h; y++) for (let x = bx; x < bx + fd.w; x++) if (b.occ[b.i(x, y)] === 2 && !b.fences.has(b.i(x, y)) || !b.inb(x, y)) ok = false;
      if (ok && by >= r.y0 - 2) {
        for (let y = by; y < by + fd.h; y++) for (let x = bx; x < bx + fd.w; x++) { b.fences.delete(b.i(x, y)); b.occ[b.i(x, y)] = 0; }
        b.building(farm, bx, by);
      }
    }
    b.scatter(DEBRIS, x0 + 1, y0 + 1, x1 - 1, y1 - 1, 0.16 * clutter, [Ter.Dirt]);
    b.scatter(['tallgrass0', 'tallgrass1'], x0 + 1, y0 + 1, x1 - 1, y1 - 1, 0.25, [Ter.Grass]);
  },
  // crop rows in tilled soil, scarecrow, fence on three sides
  crops(b, r) {
    const w = Math.min(r.x1 - r.x0 - 1, b.rint(7, 10)), h = Math.min(r.y1 - r.y0 - 1, b.rint(4, 6));
    if (w < 4 || h < 3) return LOT_THEMES.orchard(b, r, 1);
    const x0 = r.side === 'L' ? r.x1 - w : r.x0 + 1, y0 = r.y1 - h + 1;
    b.fill(x0 - 1, y0 - 1, x0 + w, r.y1, Ter.Dirt);
    for (let x = x0 - 1; x <= x0 + w; x++) b.fence(x, y0 - 2);
    for (let y = y0 - 1; y <= r.y1; y++) { b.fence(x0 - 2 < r.x0 - 1 ? x0 - 1 : x0 - 2, y); b.fence(x0 + w + 1 > r.x1 + 1 ? x0 + w : x0 + w + 1, y); }
    b.field(x0, y0, x0 + w - 1, r.y1, CROPS);
    b.place('scarecrow', x0 + (w >> 1), y0 - 1, { force: true });
    b.place(b.pick(['keg', 'chest', 'beehouse']), x0 - 1 + (r.side === 'L' ? 0 : w + 1), y0 - 1, { force: true });
  },
  // fruit trees in rows with bushes and meadow grass
  orchard(b, r) {
    const kinds = ['tree_cherry', 'tree_apple', 'tree_orange'];
    for (let y = r.y0 + 2; y <= r.y1; y += 3)
      for (let x = r.x0 + 1 + ((y / 3) & 1); x <= r.x1 - 1; x += 3) b.place(b.pick(kinds), x, y, { on: [Ter.Grass] });
    b.meadow(r.x0, r.y0, r.x1, r.y1, 3);
    b.scatter(['bush_s', 'bush_s2', 'beehouse'], r.x0, r.y0, r.x1, r.y1, 0.05, [Ter.Grass]);
  },
  // overgrown clearing: stumps, logs, boulders, heavy debris (the "new farm" look)
  wild(b, r, clutter) {
    b.blob((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2 + 1, (r.x1 - r.x0) / 2, (r.y1 - r.y0) / 2, Ter.Dirt, 0.3, [r.x0, r.y0, r.x1, r.y1]);
    b.thicken(Ter.Dirt, r.x0, r.y0, r.x1, r.y1);
    for (let k = 0; k < 4; k++) b.place(b.pick(['stump', 'log', 'boulder']), b.rint(r.x0, r.x1 - 1), b.rint(r.y0 + 1, r.y1));
    b.scatter(DEBRIS, r.x0, r.y0, r.x1, r.y1, 0.22 * clutter, [Ter.Dirt]);
    b.meadow(r.x0, r.y0, r.x1, r.y1, 3);
    b.grove(r.side === 'L' ? r.x1 - 1 : r.x0 + 1, r.y0 + 2, 2, ['tree_oak', 'tree_maple', 'bush_m']);
  },
  // tidy town garden: flower pots, bench, lamp, hedges, blossom tree
  garden(b, r) {
    const cx = (r.x0 + r.x1) >> 1;
    b.place('tree_blossom', cx - 1, r.y0 + 3, { on: [Ter.Grass] });
    b.place('bench', cx - 1, r.y1 - 1, { on: [Ter.Grass] });
    b.place('lamp', cx + 2, r.y1 - 1, { on: [Ter.Grass] });
    // clipped hedge along the front, berry bushes at the back
    for (let x = r.x0; x <= r.x1 - 1; x += 2) if (Math.abs(x - cx) > 2) b.place('bush_m', x, r.y1, { on: [Ter.Grass] });
    for (let x = r.x0; x <= r.x1 - 1; x += 3) b.place(b.pick(['bush_m', 'bush_berry']), x, r.y0 + 1, { on: [Ter.Grass] });
    b.place('flowerpot', cx - 3, r.y1 - 1, { on: [Ter.Grass] });
    b.place('flowerpot', cx + 3, r.y1 - 1, { on: [Ter.Grass] });
  },
};

// ======================================================================
// generateWorld — deterministic layout from the course list
// ======================================================================
const PLATEAU = 20;          // rows above the cliff lip
const LOT_H = 19;
const BAND = 58;             // one street + a lot on each side
const LOTS_PER_STREET = 6;   // more courses than this -> another street band

/** Street bands for a course count: the map widens (more parallel streets)
 *  rather than only growing taller, so walks stay short at any size. */
export function streetCount(n: number) {
  return Math.min(4, Math.max(1, Math.ceil(n / LOTS_PER_STREET)));
}

export function generateWorld(courses: Course[], seed = 20261024, opts: WorldOptions = {}): WorldSpec {
  const rnd = mulberry32(seed);
  const clutter = opts.clutter ?? 1;
  const fd = opts.forestDepth ?? 3;
  const S = streetCount(courses.length);
  const nRows = Math.max(1, Math.ceil(courses.length / (2 * S)));
  const lotsTop = PLATEAU + 4;
  const bottomTop = lotsTop + nRows * LOT_H;
  const H = bottomTop + 23;
  const W = 2 * fd + S * BAND;
  const b = new Builder(W, H, rnd);
  const CX = W >> 1;                   // town hall / plaza centre column
  // street centre columns (each street is 3 wide: sx-1..sx+1)
  const streets = Array.from({ length: S }, (_, k) => fd + k * BAND + (BAND >> 1));
  // lots fill the streets nearest the town hall first
  const streetOrder = streets.map((_, k) => k).sort((a, c) => Math.abs(streets[a] - CX) - Math.abs(streets[c] - CX) || a - c);

  // ---- town hall plateau ----
  const hall = b.building('b_townhall', CX - 6, 2, undefined, true);
  // plaza
  b.fill(CX - 10, hall.doorY, CX + 10, PLATEAU - 1, Ter.Paved);
  b.reserveRect(CX - 10, hall.doorY, CX + 10, PLATEAU - 1);
  for (const x of [CX - 10, CX + 10]) for (const y of [hall.doorY, PLATEAU - 1]) b.occ[b.i(x, y)] = 0;
  b.place('fountain', CX - 2, hall.doorY + 4, { force: true });
  for (const x of [CX - 9, CX + 9]) { b.place('lamp', x, hall.doorY + 1, { force: true }); b.place('lamp', x, PLATEAU - 2, { force: true }); }
  b.place('bench', CX - 7, hall.doorY + 4, { force: true });
  b.place('bench', CX + 6, hall.doorY + 4, { force: true });
  for (const x of [CX - 8, CX + 8]) b.place('flowerpot', x, hall.y + 9, { force: true });
  // side streets: a trail across the plateau from their stairs to the plaza
  for (const sx of streets) {
    if (Math.abs(sx - CX) <= 10) continue;
    const toX = sx < CX ? CX - 11 : CX + 11;
    b.trailV(sx, PLATEAU - 4, PLATEAU - 1);
    b.trail(sx, PLATEAU - 4, toX, PLATEAU - 6, PLATEAU - 3);
  }
  // a pond on one (seeded) side of the plateau — before scenery so nothing lands in it
  {
    const left = rnd() < 0.5;
    const px = left ? fd + 8 : W - 1 - fd - 8;
    b.lake(px, 12, 5.5, 3.2);
    b.place('log', px + (left ? 6 : -7), 15, { on: [Ter.Grass, Ter.Dirt] });
  }
  // flanks: park land with big trees, blossoms, meadow
  for (const [x0, x1] of [[fd, CX - 12], [CX + 12, W - 1 - fd]]) {
    const mid = (x0 + x1) >> 1;
    b.place('tree_blossom', mid - 1 + b.rint(-2, 2), 7 + b.rint(-1, 1), { on: [Ter.Grass] });
    b.place('tree_big', mid + b.rint(-5, -3), 14 + b.rint(-1, 1), { on: [Ter.Grass] });
    b.place('tree_big', mid + b.rint(3, 5), 13 + b.rint(-1, 1), { on: [Ter.Grass] });
    b.grove(x0 + 3, 5, 4); b.grove(x1 - 3, 5, 4);
    b.meadow(x0, 3, x1, PLATEAU - 2, 5);
    b.scatter(['bush_m', 'bush_berry', 'bush_m', 'bush_s'], x0, 3, x1, PLATEAU - 2, 0.03, [Ter.Grass]);
    b.scatter(GRASS_BITS, x0, 3, x1, PLATEAU - 1, 0.02, [Ter.Grass]);
  }
  // cliff wall with stairs down to the main street
  b.cliff(fd, W - 1 - fd, PLATEAU, streets.flatMap(sx => [sx - 1, sx, sx + 1]));
  // cliff foot clutter: boulders/bushes hug the wall like the reference farm
  for (let x = fd; x < W - fd; x++) {
    const y = PLATEAU + 4;
    if (streets.some(sx => Math.abs(x - sx) < 4)) continue;
    if (b.chance(0.12)) b.place(b.pick(['bush_m', 'bush_s', 'boulder', 'bush_m', 'bush_berry']), x, y + (b.chance(0.5) ? 1 : 0), { on: [Ter.Grass] });
  }

  // ---- streets ----
  for (const sx of streets) {
    b.fill(sx - 1, lotsTop, sx + 1, bottomTop + 4, Ter.Paved);
    b.reserveRect(sx - 2, lotsTop, sx + 2, bottomTop + 4);
  }

  // ---- course lots ----
  const themeNames = opts.themes ?? shuffle(Object.keys(LOT_THEMES), rnd);
  const lots: Lot[] = [];
  courses.forEach((c, i) => {
    // row-major over the streets so every band grows evenly
    const side: 'L' | 'R' = i % 2 === 0 ? 'L' : 'R';
    const row = Math.floor(i / (2 * S));
    const k = streetOrder[Math.floor(i / 2) % S], SX = streets[k];
    const y0 = lotsTop + row * LOT_H, y1 = y0 + LOT_H - 1;
    const bx0 = fd + k * BAND, bx1 = bx0 + BAND - 1;
    const x0 = side === 'L' ? bx0 : SX + 3, x1 = side === 'L' ? SX - 3 : bx1;
    const key = c.building && BUILDINGS[c.building] ? c.building : BUILDING_CYCLE[i % BUILDING_CYCLE.length];
    const d = BUILDINGS[key];
    const bx = side === 'L' ? x0 + 1 + b.rint(0, 2) : x1 - d.w - b.rint(0, 2);
    const by = y0 + 1 + Math.max(0, 9 - d.h) + b.rint(0, 1);
    const bd = b.building(key, bx, by, c);
    // dirt yard in front of the door
    b.blob(bd.doorX + 0.5, bd.doorY + 2.5, Math.max(5, d.w / 2 + 3), 3.4, Ter.Dirt, 0.3, [x0, bd.doorY, x1, y1 - 3]);
    // winding trail from the door to the street
    const streetEdge = side === 'L' ? SX - 2 : SX + 2;
    b.trailV(bd.doorX, bd.doorY, bd.doorY + 1);
    const lo = bd.doorY + 1, hi = Math.min(y1 - 3, bd.doorY + 4);
    b.trail(bd.doorX, bd.doorY + 1, streetEdge, lo, hi);
    b.place('mailbox', bd.doorX + (side === 'L' ? -2 : 3), bd.doorY, { on: [Ter.Grass, Ter.Dirt] });
    // themed yard beside the building, above the trail
    const theme = themeNames[i % themeNames.length];
    const r: LotRect = side === 'L'
      ? { x0: bx + d.w + 2, y0: y0 + 1, x1: x1 - 1, y1: lo - 2, side }
      : { x0: x0 + 1, y0: y0 + 1, x1: bx - 3, y1: lo - 2, side };
    if (r.x1 - r.x0 >= 4 && r.y1 - r.y0 >= 3) LOT_THEMES[theme](b, r, clutter);
    // yard debris + forage, meadow and trees in the rest of the lot
    b.scatter(DEBRIS, x0, bd.doorY, x1, y1, 0.12 * clutter, [Ter.Dirt]);
    b.meadow(x0, bd.doorY + 2, x1, y1 - 1, 3);
    b.scatter(GRASS_BITS, x0, y0, x1, y1, 0.025 * clutter, [Ter.Grass]);
    // lot boundary: a fence run along the bottom, broken by a tree cluster
    const fy = y1;
    const fa = side === 'L' ? x0 + b.rint(1, 4) : x0 + b.rint(4, 8);
    const fb = side === 'L' ? x1 - b.rint(4, 8) : x1 - b.rint(1, 4);
    for (let x = fa; x <= fb; x++) if (b.free(x, fy) && b.t(x, fy) === Ter.Grass) b.fence(x, fy);
    b.grove(side === 'L' ? x0 + 2 : x1 - 2, y1 - 2, 3, ['tree_oak', 'tree_maple', 'tree_pine', 'bush_m']);
    b.grove(side === 'L' ? fb + 3 : fa - 3, y1 - 1, 2, ['tree_oak', 'tree_maple', 'bush_l']);
    lots.push({ side, x0, y0, x1, y1, theme, building: bd });
  });

  // ---- bottom zone: lake (west), big farm field + barn (east) ----
  const by0 = bottomTop + 1;
  if (opts.lake ?? true) {
    b.lake(fd + 12, by0 + 9, 9.5, 5.2);
    b.place('log', fd + 3, by0 + 2, { on: [Ter.Grass, Ter.Dirt] });
    b.grove(fd + 2, by0 + 13, 3);
  }
  // streets end in dirt clearings joined by a trail that leads to the fields
  for (const sx of streets) b.blob(sx + 0.5, bottomTop + 6, 4, 2.6, Ter.Dirt, 0.25);
  const lastSX = streets[S - 1];
  for (let k = 0; k < S - 1; k++) b.trail(streets[k] + 2, bottomTop + 6, streets[k + 1] - 2, bottomTop + 5, bottomTop + 7);
  b.trail(lastSX + 2, bottomTop + 6, lastSX + 8, bottomTop + 5, bottomTop + 7);
  {
    const fx0 = lastSX + 9, fx1 = Math.min(W - 1 - fd - 2, fx0 + 40), fy0 = by0 + 3, fy1 = by0 + 13;
    b.building('b_barn', fx1 - 6, fy0 - 3);
    b.building('b_silo', fx1 - 10, fy0 - 4);
    b.fill(fx0, fy0 + 5, fx1, fy1 + 1, Ter.Dirt);
    b.fenceRect(fx0 - 1, fy0 + 4, fx1 + 1, fy1 + 2, [[fx0 + 1, fy0 + 4], [fx0 + 2, fy0 + 4]]);
    b.field(fx0 + 1, fy0 + 6, fx1 - 1, fy1, CROPS);
    b.place('scarecrow', (fx0 + fx1) >> 1, fy0 + 5, { force: true });
    b.blob(fx0 + 2, fy0 + 1, 4, 2, Ter.Dirt, 0.2);
    b.scatter(DEBRIS, fx0 - 2, fy0 - 2, fx1, fy0 + 3, 0.1 * clutter, [Ter.Dirt]);
  }
  b.meadow(fd, by0, W - fd, H - fd - 1, 8);
  b.scatter(GRASS_BITS, fd, by0, W - fd, H - fd - 1, 0.02, [Ter.Grass]);
  b.scatter(['bush_m', 'bush_berry', 'bush_s'], fd, by0, W - fd, H - fd - 1, 0.015, [Ter.Grass]);

  // ---- fill leftover open grass with groves / bushes (dense SDV look) ----
  fillEmpty(b, fd);

  // ---- forest frame ----
  b.forest(0, 0, W - 1, 1);
  b.forest(0, 0, fd - 1, H - 1);
  b.forest(W - fd, 0, W - 1, H - 1);
  b.forest(0, H - fd, W - 1, H - 1);
  // ragged inner edge: extra trees poking out of the forest
  for (let y = 3; y < H - fd; y += 2) {
    if (b.chance(0.5)) b.place(b.pick(['tree_oak', 'tree_pine', 'bush_m']), fd, y, { on: [Ter.Grass] });
    if (b.chance(0.5)) b.place(b.pick(['tree_oak', 'tree_pine', 'bush_m']), W - fd - 1, y, { on: [Ter.Grass] });
  }

  b.thicken(Ter.Dirt);

  // ---- finalise: blocking + guaranteed reachability ----
  const spawn = { x: CX + 3, y: hall.doorY + 2 };
  const blocked = computeBlocked(b);
  ensureReachable(b, blocked, spawn);
  const ground = buildGround(b);
  const npcHomes = [
    { x: CX - 6, y: hall.doorY + 2 }, { x: CX + 6, y: hall.doorY + 2 },
    { x: CX - 5, y: PLATEAU - 2 }, { x: CX + 5, y: PLATEAU - 2 },
  ];
  return {
    seed, w: W, h: H, ground, blocked,
    buildings: b.buildings, props: finalizeProps(b), lots, spawn, npcHomes,
  };
}

/** Any open grass >=2 tiles from walkways gets a chance of a grove or bush. */
function fillEmpty(b: Builder, fd: number) {
  const near = (x: number, y: number, r: number) => {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++)
      if (b.inb(xx, yy) && (b.occ[b.i(xx, yy)] !== 0 || b.t(xx, yy) !== Ter.Grass)) return true;
    return false;
  };
  for (let y = 3; y < b.h - fd; y += 2) for (let x = fd; x < b.w - fd; x += 2) {
    if (near(x, y, 2)) continue;
    const r = b.rnd();
    if (r < 0.35) b.grove(x, y, b.rint(2, 4), ['tree_oak', 'tree_maple', 'tree_pine', 'tree_oak', 'bush_m'], 2);
    else if (r < 0.55) b.place(b.pick(['bush_m', 'bush_berry', 'bush_l', 'bush_s']), x, y, { on: [Ter.Grass] });
  }
}

function shuffle<X>(a: X[], rnd: Rng): X[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

function computeBlocked(b: Builder): Uint8Array {
  const bl = new Uint8Array(b.w * b.h);
  for (let c = 0; c < bl.length; c++) if (b.hard[c] || b.solidBy[c] >= 0) bl[c] = 1;
  for (const [c, f] of b.fences) if (!f.gate) bl[c] = 1;
  return bl;
}

// BFS from spawn; any door it can't reach gets a path cut through soft
// blockers (props/fences) along the shortest route around hard ones.
function ensureReachable(b: Builder, bl: Uint8Array, spawn: { x: number; y: number }) {
  const W = b.w, H = b.h;
  const bfs = (passable: (c: number) => boolean, from: number) => {
    const prev = new Int32Array(W * H).fill(-2);
    const q = [from]; prev[from] = -1;
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi], x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const n = ny * W + nx;
        if (prev[n] !== -2 || !passable(n)) continue;
        prev[n] = c; q.push(n);
      }
    }
    return prev;
  };
  const s = spawn.y * W + spawn.x;
  for (const bd of b.buildings) {
    if (!bd.course && !bd.townHall) continue;
    const d = bd.doorY * W + bd.doorX;
    if (bfs(c => !bl[c], s)[d] !== -2) continue;
    const prev = bfs(c => !b.hard[c] || c === d, s);
    for (let c = d; c >= 0 && prev[c] !== -2; c = prev[c]) {
      const x = c % W, y = (c / W) | 0;
      if (b.solidBy[c] >= 0) b.removePropAt(x, y);
      const f = b.fences.get(c);
      if (f) f.gate = true;
      bl[c] = b.hard[c];
    }
  }
}

function finalizeProps(b: Builder): PlacedProp[] {
  const out = b.props.filter((p): p is PlacedProp => !!p);
  // fences -> Fence1 pieces by neighbour sum (exactly like Fence.getDrawSum)
  for (const [c] of b.fences) {
    const x = c % b.w, y = (c / b.w) | 0;
    const has = (xx: number, yy: number) => b.inb(xx, yy) && b.fences.has(b.i(xx, yy));
    const sum = (has(x + 1, y) ? 100 : 0) + (has(x - 1, y) ? 10 : 0) + (has(x, y + 1) ? 500 : 0) + (has(x, y - 1) ? 1000 : 0);
    const gate = b.fences.get(c)!.gate;
    if (gate && sum === 110) {
      out.push({ key: 'gate', x, y, px: x * T - 4, py: (y - 1) * T, tex: 'fence', rect: [0, 128, 24, 32], depth: y * T + T / 2 + 1, flat: false });
      continue;
    }
    if (gate) continue; // gate on a corner/vertical run: leave an opening
    const p = FENCE_GUIDE[sum] ?? 5;
    out.push({ key: 'fence', x, y, px: x * T, py: (y - 1) * T, tex: 'fence', rect: [(p % 3) * 16, Math.floor(p / 3) * 32, 16, 32], depth: y * T + T / 2, flat: false });
  }
  return out;
}

// ---------- autotiling: terrain grid -> tileset frames ----------
function buildGround(b: Builder): Int16Array {
  const g = new Int16Array(b.w * b.h);
  const is = (x: number, y: number, t: Ter) => b.t(x, y) === t;
  // dirt counts tilled/stairs-foot as dirt so fields sit inside yards cleanly
  const dirtish = (x: number, y: number) => { const t = b.t(x, y); return t === Ter.Dirt || t === Ter.Tilled; };
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const c = b.i(x, y), h = hash2(x, y);
    if (b.over[c] >= 0) { g[c] = b.over[c]; continue; }
    switch (b.ter[c]) {
      case Ter.Dirt: {
        g[c] = TILE[edge(dirtish, x, y, 'D', () => {
          const r = h % 100;
          return r < 3 ? 'D_PRINT' : r < 5 ? 'D_PEBBLE' : r < 7 ? 'D_PRINT2' : r < 40 ? 'D_I1' : r < 55 ? 'D_I2' : 'D_I0';
        })];
        break;
      }
      case Ter.Water: {
        const name = edge((xx, yy) => is(xx, yy, Ter.Water), x, y, 'SH', () => {
          const r = h % 100;
          return r < 3 ? 'WATER_LILY' : r < 5 ? 'WATER_LILY2' : 'WATER';
        });
        // vertical shore variants for rhythm
        g[c] = TILE[(name === 'SH_W' && y % 2 ? 'SH_W2' : name === 'SH_E' && y % 2 ? 'SH_E2' : name) as TileName];
        break;
      }
      case Ter.Tilled: {
        const m = (is(x, y - 1, Ter.Tilled) ? 1 : 0) | (is(x + 1, y, Ter.Tilled) ? 2 : 0) | (is(x, y + 1, Ter.Tilled) ? 4 : 0) | (is(x - 1, y, Ter.Tilled) ? 8 : 0);
        g[c] = TILE[`TILL_${m}` as TileName];
        break;
      }
      case Ter.Paved: g[c] = TILE[`COB${h % 4}` as TileName]; break;
      case Ter.Forest: g[c] = TILE.G_DARK; break;
      default: {
        const r = h % 100;
        g[c] = TILE[r < 3 ? 'G_FLO_W' : r < 5 ? 'G_FLO_Y' : r < 17 ? 'G_TUFT' : r < 25 ? 'G_ALT' : 'G'];
      }
    }
  }
  return g;
}

/** SDV-style 4-neighbour + inner-corner autotile; prefix 'D' or 'SH'. */
function edge(isIn: (x: number, y: number) => boolean, x: number, y: number, p: 'D' | 'SH', interior: () => string): TileName {
  const n = isIn(x, y - 1), s = isIn(x, y + 1), w = isIn(x - 1, y), e = isIn(x + 1, y);
  let k = '';
  if (!n && !w) k = 'NW';
  else if (!n && !e) k = 'NE';
  else if (!s && !w) k = 'SW';
  else if (!s && !e) k = 'SE';
  else if (!n) k = 'N';
  else if (!s) k = 'S';
  else if (!w) k = 'W';
  else if (!e) k = 'E';
  else if (!isIn(x - 1, y - 1)) k = 'INW';
  else if (!isIn(x + 1, y - 1)) k = 'INE';
  else if (!isIn(x - 1, y + 1)) k = 'ISW';
  else if (!isIn(x + 1, y + 1)) k = 'ISE';
  return (k ? `${p}_${k}` : interior()) as TileName;
}
