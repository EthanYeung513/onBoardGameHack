import type { Doc } from "../_generated/dataModel";

// Brain page partitions (skills/extend-knowledge-graph step 3): one row per fact category with the
// cluster colour, legend label and layout centre. The first five rows are brain.html's CLUSTERS
// verbatim (name, colour, x/y as fractions of the viewport); the last three cover the remaining
// fact categories and only appear in the legend when they hold nodes. These are Orthogonal product
// chrome, not company colours, so they don't come from brand_profiles.

export type Category = Doc<"facts">["category"];
export type EntityType = Doc<"entities">["type"];

export type Partition = { name: Category; color: string; x: number; y: number; mockup: boolean };

export const PARTITIONS: Partition[] = [
  { name: "People", color: "#5b8cff", x: 0.3, y: 0.3, mockup: true },
  { name: "Glossary", color: "#f5a623", x: 0.72, y: 0.28, mockup: true },
  { name: "Tools", color: "#34c98e", x: 0.74, y: 0.7, mockup: true },
  { name: "Rituals", color: "#b07df0", x: 0.28, y: 0.72, mockup: true },
  { name: "Docs & History", color: "#f06ba8", x: 0.5, y: 0.52, mockup: true },
  { name: "Policy", color: "#4fc3d9", x: 0.5, y: 0.16, mockup: false },
  { name: "Product", color: "#e8d04f", x: 0.9, y: 0.48, mockup: false },
  { name: "Other", color: "#8a8a94", x: 0.1, y: 0.5, mockup: false },
];

export const partitionOf = (name: Category): Partition => PARTITIONS.find((p) => p.name === name) ?? PARTITIONS[7];

/** Cluster for an entity with no visible facts yet, from its type. */
export const TYPE_PARTITION: Record<EntityType, Category> = {
  person: "People",
  org_unit: "People",
  term: "Glossary",
  tool: "Tools",
  ritual: "Rituals",
  doc: "Docs & History",
  policy: "Policy",
  product: "Product",
};

/** Deterministic [0,1) stream from a string (FNV-1a seed + LCG — the mockup's rng, seeded per id). */
export function seededRandom(key: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) seed = Math.imul(seed ^ key.charCodeAt(i), 16777619) >>> 0;
  seed %= 2147483648;
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

/** Initial position around the partition centre, using brain.html's spread (d = .055–.17, y × .8). */
export function seededPosition(id: string, p: Partition): { x: number; y: number } {
  const rnd = seededRandom(id);
  const a = rnd() * Math.PI * 2;
  const d = 0.055 + rnd() * 0.115;
  return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d * 0.8 };
}
