import { PARTITIONS, type Category } from "@convex/lib/partitions";
import type { BrainGraph, GraphNode } from "@convex/brain";

// Turns the `brain.graph` payload into brain.html's picture: a white company hub, one labelled
// anchor per partition (hub → anchor → member links, as in the mockup), then the entity nodes and
// their real edges. Indices are stable across live updates — new entities append, removed ones
// become absent (NaN) — so cosmos.gl animates additions instead of re-laying the graph.

export const HUB = 0;
export const anchorIndex = (c: Category) => 1 + PARTITIONS.findIndex((p) => p.name === c);
export const FIRST_ENTITY = 1 + PARTITIONS.length;

/** Space-unit length of the layout plane's longer side; the other follows the viewport aspect (mockup W×H). */
const PLANE = 2400;
const OFFSET = 800;

export type Slots = { ids: string[]; index: Map<string, number> };
export const emptySlots = (): Slots => ({ ids: [], index: new Map() });

/** Assign stable indices; mutates and returns `slots`. */
export function assignSlots(slots: Slots, nodes: GraphNode[]): Slots {
  for (const n of nodes) {
    if (slots.index.has(n.id)) continue;
    slots.index.set(n.id, FIRST_ENTITY + slots.ids.length);
    slots.ids.push(n.id);
  }
  return slots;
}

export type Rendered = {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  links: Float32Array;
  linkColors: Float32Array;
  /** Entity at each point index (undefined for hub/anchors/absent). */
  nodeAt: (GraphNode | undefined)[];
  /** Partition anchors currently shown. */
  anchors: Category[];
  stale: number[];
};

function rgba(hex: string, a: number): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

/** Pixel diameter: brain.html draws r = 3.5–7.5 for members, 15 for anchors, 26 for the hub. */
export const nodeRadius = (size: number) => 3.5 + Math.min(6, Math.sqrt(size) * 1.2);

export function build(graph: BrainGraph, slots: Slots, aspect: number): Rendered {
  const count = FIRST_ENTITY + slots.ids.length;
  // The longer viewport side spans PLANE so the layout always fits inside spaceSize.
  const a = Math.min(2.5, Math.max(0.4, aspect));
  const W = a >= 1 ? PLANE : PLANE * a;
  const H = a >= 1 ? PLANE / a : PLANE;
  // cosmos.gl's y axis points up; the mockup's fractions point down.
  const place = (x: number, y: number): [number, number] => [OFFSET + x * W, OFFSET + (1 - y) * H];
  const positions = new Float32Array(count * 2).fill(NaN);
  const colors = new Float32Array(count * 4);
  const sizes = new Float32Array(count);
  const nodeAt: (GraphNode | undefined)[] = new Array(count);
  const links: number[] = [];
  const linkColors: number[] = [];
  const link = (a: number, b: number, hex: string) => {
    links.push(a, b);
    linkColors.push(...rgba(hex, 0x28 / 255));
  };

  const used = new Set(graph.nodes.map((n) => n.cluster));
  const anchors = PARTITIONS.filter((p) => p.mockup || used.has(p.name)).map((p) => p.name);

  positions.set(place(0.5, 0.46), HUB * 2);
  colors.set([1, 1, 1, 1], HUB * 4);
  sizes[HUB] = 52;
  for (const p of PARTITIONS) {
    const i = anchorIndex(p.name);
    colors.set(rgba(p.color, 1), i * 4);
    sizes[i] = 30;
    if (!anchors.includes(p.name)) continue;
    positions.set(place(p.x, p.y), i * 2);
    link(HUB, i, "#ffffff");
  }

  const stale: number[] = [];
  for (const n of graph.nodes) {
    const i = slots.index.get(n.id)!;
    nodeAt[i] = n;
    positions.set(place(n.x, n.y), i * 2);
    // Stale nodes are dimmed and outlined (the self-updating brain made visible).
    colors.set(rgba(n.color, n.stale ? 0.35 : 0.85), i * 4);
    sizes[i] = nodeRadius(n.size) * 2;
    if (n.stale) stale.push(i);
    link(anchorIndex(n.cluster), i, n.color);
  }
  for (const e of graph.edges) {
    const a = slots.index.get(e.source);
    const b = slots.index.get(e.target);
    if (a === undefined || b === undefined || !nodeAt[a] || !nodeAt[b]) continue;
    link(a, b, nodeAt[a]!.color);
  }
  return {
    positions,
    colors,
    sizes,
    links: new Float32Array(links),
    linkColors: new Float32Array(linkColors),
    nodeAt,
    anchors,
    stale,
  };
}

let webgl: boolean | undefined;
/** Probed once per page load (each probe would otherwise hold a WebGL context). */
export function webglAvailable(): boolean {
  if (webgl === undefined) {
    try {
      webgl = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
