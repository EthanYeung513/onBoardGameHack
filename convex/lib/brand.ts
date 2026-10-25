import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { candidatesFromProfile, normaliseFont, normaliseRadius } from "../../src/lib/brand/normalise";
import { poolFor } from "../../src/lib/brand/heuristic";
import { toHex } from "../../src/lib/brand/colormath";
import { FEATURE_VERSION, poolFeatures } from "../../src/lib/brand/features";
import { learnedRecommend } from "../../src/lib/brand/ranker";
import { BRAND_FIELDS, type BrandField, type DecisionRecord, type FieldRecommendation, type StoredRecommendation } from "../../src/lib/brand/types";
import { fail } from "./errors";

// Convex-side helpers for convex/brand.ts: reading the space's brand profile, the recommendation
// (stored at scan time, or computed from history on the fly), validating and applying a choice.

export async function latestProfile(ctx: QueryCtx, space: Doc<"spaces">): Promise<Doc<"brand_profiles"> | null> {
  if (space.brandProfileId) {
    const p = await ctx.db.get(space.brandProfileId);
    if (p) return p;
  }
  return await ctx.db
    .query("brand_profiles")
    .withIndex("by_space", (q) => q.eq("spaceId", space._id))
    .order("desc")
    .first();
}

export function toDecisionRecord(d: Doc<"brand_decisions">): DecisionRecord {
  return {
    spaceId: d.spaceId,
    field: d.field,
    host: d.companyProfile.host,
    category: d.companyProfile.category,
    industry: d.companyProfile.industry,
    chosen: d.chosen,
    recommended: d.recommended,
    accepted: d.accepted,
    features: d.features,
    chosenFeatures: d.chosenFeatures,
    featureVersion: d.featureVersion,
    embedding: d.embedding,
    embeddingMode: d.embeddingMode,
  };
}

export async function recentDecisions(ctx: QueryCtx, limit: number): Promise<DecisionRecord[]> {
  const rows = await ctx.db.query("brand_decisions").order("desc").take(limit);
  return rows.reverse().map(toDecisionRecord);
}

/** The stored scan-time recommendation, or one computed now from candidates + decision history. */
export async function currentRecommendation(ctx: QueryCtx, space: Doc<"spaces">, profile: Doc<"brand_profiles">): Promise<StoredRecommendation> {
  const stored = profile.recommendation as StoredRecommendation | undefined;
  if (stored?.fields) return stored;
  const c = candidatesFromProfile(profile);
  const learned = learnedRecommend(c, await recentDecisions(ctx, 300), { host: space.host });
  const fields = {} as Record<BrandField, FieldRecommendation>;
  for (const f of BRAND_FIELDS) {
    const { candidates, recommended, reason, source } = learned[f];
    fields[f] = { candidates, recommended, reason, source };
  }
  const features = Object.fromEntries(BRAND_FIELDS.map((f) => [f, poolFeatures(f, poolFor(f, c, fields.primary.recommended), { surface: c.surface, primary: fields.primary.recommended })])) as StoredRecommendation["features"];
  return {
    fields,
    requestId: null,
    companyProfile: { host: space.host, name: space.name, voice: profile.voice || undefined, paletteSummary: "" },
    features,
    featureVersion: FEATURE_VERSION,
    computedAt: Date.now(),
  };
}

/** The value currently applied to the profile for a field. */
export function currentValue(p: Doc<"brand_profiles">, field: BrandField): string | null {
  if (field === "radius") return p.radius ?? null;
  if (field === "headline") return p.typography.heading.family;
  return p.palette.find((c) => c.role === field)?.hex ?? null;
}

/** Validates/normalises a manager's pick; 422 on anything that isn't a token value. */
export function normaliseChoice(field: BrandField, chosen: string): string {
  const value =
    field === "primary" || field === "accent" ? toHex(chosen) : field === "radius" ? normaliseRadius(chosen) : /[;{}<>]/.test(chosen) ? null : normaliseFont(chosen);
  if (!value) fail(422, `"${chosen.slice(0, 40)}" is not a valid ${field}`);
  return value;
}

/** Patch applying one token value to a brand profile (callers bump tokensVersion). */
export function applyToken(p: Pick<Doc<"brand_profiles">, "palette" | "typography" | "radius">, field: BrandField, value: string) {
  if (field === "radius") return { radius: value };
  if (field === "headline") return { typography: { ...p.typography, heading: { ...p.typography.heading, family: value } } };
  const palette = p.palette.some((c) => c.role === field)
    ? p.palette.map((c) => (c.role === field ? { ...c, hex: value } : c))
    : [...p.palette, { name: field === "primary" ? "Primary" : "Accent", hex: value, role: field }];
  return { palette };
}
