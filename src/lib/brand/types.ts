// Learned brand recommendations (S19, D-27). Shared by the worker (scan-time recommendation),
// Convex (`convex/brand.ts` options/decide) and the replay eval. Pure types: no runtime imports,
// so Convex can bundle everything under src/lib/brand except recommend.ts / memory.ts.

export const BRAND_FIELDS = ["primary", "accent", "radius", "headline"] as const;
export type BrandField = (typeof BRAND_FIELDS)[number];

/** One raw candidate after normalisation: a value, how often it was seen and where. */
export interface RawCandidate {
  value: string;
  usage: number;
  /** Where the value was found, e.g. `css-var:--brand-primary`, `theme-color`, `button`, `heading`. */
  where: string[];
}

/** Everything extract_design found, normalised from whatever shape the scan stage stored. */
export interface BrandCandidates {
  colors: RawCandidate[];
  radii: RawCandidate[];
  fonts: RawCandidate[];
  /** Page surface colour the contrast features are measured against (default white). */
  surface?: string;
}

/** What the Design tab shows per option. */
export interface Candidate {
  value: string;
  evidence: string;
}

export interface CompanyProfile {
  host: string;
  name?: string;
  category?: string;
  industry?: string;
  voice?: string;
  description?: string;
  /** e.g. "blue #635bff (css-var brand), dark #0a2540 ×120, …" — derived from the candidates. */
  paletteSummary: string;
}

export type RecommendationSource = "mubit" | "learned" | "heuristic";

export interface FieldRecommendation {
  candidates: Candidate[];
  recommended: string;
  reason: string;
  source: RecommendationSource;
}

export type Features = Record<string, number>;

/** Stored on `brand_profiles.recommendation` at scan time so `brand.options` is instant. */
export interface StoredRecommendation {
  fields: Record<BrandField, FieldRecommendation>;
  /** Mubit request id of the `brand.recommend` call (feedback is keyed by it), null when offline. */
  requestId: string | null;
  companyProfile: CompanyProfile;
  /** Per field, per candidate value: the features the ranker scored (stored with each decision). */
  features: Record<BrandField, { value: string; f: Features }[]>;
  featureVersion: number;
  /** Profile embedding (Mubit embeddings, or the labelled hashed stand-in) for precedent search. */
  embedding?: number[];
  embeddingMode?: "live" | "offline";
  model?: string;
  computedAt: number;
}

/** A past manager decision as the ranker sees it (a `brand_decisions` row, trimmed). */
export interface DecisionRecord {
  spaceId?: string;
  field: BrandField;
  host: string;
  category?: string;
  industry?: string;
  chosen: string;
  recommended: string;
  accepted: boolean;
  features: { value: string; f: Features }[];
  chosenFeatures: Features;
  featureVersion: number;
  embedding?: number[];
  embeddingMode?: "live" | "offline";
}
