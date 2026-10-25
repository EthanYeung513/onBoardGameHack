import { api } from "@convex/_generated/api";

// The editor's writes go through the owners' Convex modules (D-28): `api.courses` (D-26) and
// `api.brand` (D-27).

export type CoursePatch = { op: "set" | "add" | "remove"; path: string; value?: unknown };

export const courseFns = {
  /** 409 when `version` is stale, 422 when the patched spec fails CourseSpec validation. */
  applyPatch: api.courses.applyPatch,
  /** Manager-confirmed regeneration of the steps flagged stale (F36); clears them on completion. */
  regenerateSteps: api.courses.regenerateSteps,
};

export const BRAND_FIELDS = ["primary", "accent", "radius", "headline"] as const;
export type BrandField = (typeof BRAND_FIELDS)[number];

export type BrandCandidate = { value: string; evidence?: string };
export type BrandFieldOptions = {
  candidates: BrandCandidate[];
  recommended: string;
  reason: string;
  source: "mubit" | "learned" | "heuristic";
  /** The token currently applied on the brand profile (headline = heading font family). */
  current?: string | null;
};
export type BrandOptions = { fields: Partial<Record<BrandField, BrandFieldOptions>>; requestId?: string | null };

/** convex/brand.ts is on the base branch (D-27): the generated references. */
export const brandFns = { options: api.brand.options, decide: api.brand.decide };
