import { candidateFeatures } from "./features";
import { sameValue } from "./ranker";
import type { BrandField, DecisionRecord, StoredRecommendation } from "./types";

// One manager pick → the evidence row the ranker learns from. Used by `brand.decide` (Convex) and
// by the replay eval, so both store exactly the same features.

export function buildDecision(rec: StoredRecommendation, field: BrandField, chosen: string) {
  const r = rec.fields[field];
  const features = rec.features?.[field] ?? [];
  const hit = features.find((x) => sameValue(field, x.value, chosen));
  const chosenFeatures = hit?.f ?? candidateFeatures(field, { value: chosen, usage: 0, where: ["manager-custom"] }, [], { primary: rec.fields.primary?.recommended });
  const accepted = Boolean(r.recommended) && sameValue(field, chosen, r.recommended);
  return { field, candidates: r.candidates, recommended: r.recommended, recommendedSource: r.source, chosen, accepted, features, chosenFeatures, featureVersion: rec.featureVersion };
}

export function toRecord(rec: StoredRecommendation, d: ReturnType<typeof buildDecision>): DecisionRecord {
  const p = rec.companyProfile;
  return { ...d, host: p.host, category: p.category, industry: p.industry, embedding: rec.embedding, embeddingMode: rec.embeddingMode };
}
