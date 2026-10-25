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
  /** Character offsets of the supporting passage inside the chunk. */
  span: z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }),
});

export const ExtractedEntity = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  keys: z
    .object({ email: z.string().trim().optional(), login: z.string().trim().optional(), url: z.string().trim().optional() })
    .default({}),
});

export const ExtractedEdge = z.object({
  source: z.string().trim().min(1),
  target: z.string().trim().min(1),
  relation: z.enum(RELATIONS),
  evidence: z.string().trim().max(300).default(""),
});

export const ExtractionBatch = z.object({
  facts: z.array(ExtractedFact).max(30).default([]),
  entities: z.array(ExtractedEntity).max(40).default([]),
  edges: z.array(ExtractedEdge).max(40).default([]),
});

export type ExtractionBatch = z.infer<typeof ExtractionBatch>;
export type ExtractedEntity = z.infer<typeof ExtractedEntity>;

/** LLM adjudication for an ambiguous entity pair (F15). */
export const Adjudication = z.object({
  same: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300).default(""),
});
export type Adjudication = z.infer<typeof Adjudication>;
