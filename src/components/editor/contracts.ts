import { makeFunctionReference } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// INTEGRATION POINT (D-28). The editor's writes belong to two parallel agents' Convex modules:
//   - convex/courses.ts (course generation, D-26): applyPatch, regenerateSteps — wired to `api.courses`
//   - convex/brand.ts   (brand learning,   D-27): options, decide — typed references until it merges
// These typed references are the agreed contracts (docs/BUILD-CONTRACT.md "Course contract",
// brand addendum). Once both modules are on the base branch, replace each reference with
// `api.courses.*` / `api.brand.*` from `@convex/_generated/api` — call sites don't change.
// Until then calls fail honestly (a toast, or the Design tab without recommendations), never faked.

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
