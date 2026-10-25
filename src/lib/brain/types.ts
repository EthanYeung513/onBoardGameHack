import { z } from "zod";
import { entityType, factCategory, relation } from "@convex/schema";
import type { Infer } from "convex/values";

// The brain's enums come from the Convex schema (one source of truth) and feed the extraction Zod
// schema the model's JSON is validated against (AGENTS.md "Model boundaries").

export type EntityType = Infer<typeof entityType>;
export type Relation = Infer<typeof relation>;
export type FactCategory = Infer<typeof factCategory>;

const values = <T extends string>(u: { members: { value: T }[] }) => u.members.map((m) => m.value) as [T, ...T[]];
export const ENTITY_TYPES = values<EntityType>(entityType as never);
export const RELATIONS = values<Relation>(relation as never);
export const FACT_CATEGORIES = values<FactCategory>(factCategory as never);

export const ExtractedFact = z.object({
  category: z.enum(FACT_CATEGORIES),
  text: z.string().trim().min(8).max(400),
  entity_names: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  confidence: z.number().min(0).max(1),
  /**
   * Character offsets of the supporting passage inside the chunk. The model often writes the span
   * as `[start, end]`; accepting that shape (profiled: it failed validation on every first attempt)
   * saves a full retry round trip per extraction call.
   */
  span: z.preprocess(
    (v) => (Array.isArray(v) && v.length === 2 ? { start: v[0], end: v[1] } : v),
    z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }),
  ),
});

export const ExtractedEntity = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  keys: z.preprocess(
    entityKeysShape,
    z.object({ email: z.string().trim().optional(), login: z.string().trim().optional(), url: z.string().trim().optional() }).default({}),
  ),
});

/**
 * The model often writes `keys` as an array (`[]` or `["dana@acme.com"]`) or with null values.
 * Normalising those shapes here (profiled: it failed validation on most first attempts) saves a
 * retry round trip per extraction call. Strings are sorted into email / url / login by shape.
 */
function entityKeysShape(v: unknown): unknown {
  if (v === null || v === undefined) return {};
  if (Array.isArray(v)) {
    const out: Record<string, string> = {};
    for (const s of v) {
      if (typeof s !== "string" || !s.trim()) continue;
      const k = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? "email" : /^https?:\/\//i.test(s) ? "url" : s.startsWith("@") ? "login" : null;
      if (k && !out[k]) out[k] = s;
    }
    return out;
  }
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k, x]) => ["email", "login", "url"].includes(k) && typeof x === "string" && x.trim()));
  return v;
}

export const ExtractedEdge = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  relation: z.enum(RELATIONS),
  evidence: z.string().trim().max(300).default(""),
});

/**
 * Item-level leniency: an invalid fact, entity or edge is dropped (and the list capped) instead of
 * failing the whole multi-passage call. Profiled: one off-vocabulary edge relation used to cost a
 * full 10 to 20 s retry of every passage in the call. Only items that validate are ever kept.
 */
function lenientArray<T extends z.ZodTypeAny>(item: T, max: number) {
  return z
    .array(z.unknown())
    .default([])
    .transform((items) => items.flatMap((i) => {
      const r = item.safeParse(i);
      return r.success ? [r.data as z.output<T>] : [];
    }).slice(0, max));
}

export const ExtractionBatch = z.object({
  facts: lenientArray(ExtractedFact, 30),
  entities: lenientArray(ExtractedEntity, 40),
  edges: lenientArray(ExtractedEdge, 40),
});

export type ExtractionBatch = z.infer<typeof ExtractionBatch>;

/** `brain_extract_batch`: one ExtractionBatch per passage id. */
export const MultiExtraction = z.object({
  results: z.array(ExtractionBatch.extend({ id: z.string().trim().min(1) })).max(40).default([]),
});
export type MultiExtraction = z.infer<typeof MultiExtraction>;
export type ExtractedEntity = z.infer<typeof ExtractedEntity>;

/** LLM adjudication for an ambiguous entity pair (F15). */
export const Adjudication = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300).default(""),
});
export type Adjudication = z.infer<typeof Adjudication>;
