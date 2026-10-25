import { makeFunctionReference } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";

// INTEGRATION POINT (D-28). The editor's writes belong to two parallel agents whose Convex modules
// were not merged when the editor shipped:
//   - convex/courses.ts (course generation, D-26): applyPatch, regenerateSteps
//   - convex/brand.ts   (brand learning,   D-27): options, decide
// These typed references are the agreed contracts (docs/BUILD-CONTRACT.md "Course contract",
// brand addendum). Once both modules are on the base branch, replace each reference with
// `api.courses.*` / `api.brand.*` from `@convex/_generated/api` — call sites don't change.
// Until then calls fail honestly (a toast, or the Design tab without recommendations), never faked.

export type CoursePatch = { op: "set" | "add" | "remove"; path: string; value?: unknown };

export const courseFns = {
  /** 409 when `version` is stale, 422 when the patched spec fails CourseSpec validation. */
  applyPatch: makeFunctionReference<"mutation", { courseId: Id<"courses">; version: number; patches: CoursePatch[] }, unknown>(
    "courses:applyPatch",
  ),
  /** Manager-confirmed regeneration of the steps flagged stale (F36); clears them on completion. */
  regenerateSteps: makeFunctionReference<"mutation", { courseId: Id<"courses">; stepIds: string[] }, unknown>("courses:regenerateSteps"),
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

export const brandFns = {
  options: makeFunctionReference<"query", { spaceId: Id<"spaces"> }, BrandOptions | null>("brand:options"),
  decide: makeFunctionReference<"mutation", { spaceId: Id<"spaces">; field: BrandField; chosen: string; recommended?: string }, unknown>(
    "brand:decide",
  ),
};
