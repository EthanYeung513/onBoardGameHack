import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { StyleCues } from "../src/lib/brand/candidates";
import { buildThemes, type Theme } from "../src/lib/brand/themes";
import { buildDecision } from "../src/lib/brand/decision";
import { BRAND_FIELDS, type BrandField, type StoredRecommendation } from "../src/lib/brand/types";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { applyToken, currentRecommendation, currentValue, latestProfile, normaliseChoice, recentDecisions } from "./lib/brand";
import { fail } from "./lib/errors";
import { workerMutation, workerQuery } from "./lib/worker";
import { brandField } from "./schema";

// Learned brand recommendations (F37, D-27). The scan stores a recommendation per field on the
// brand profile (worker: src/lib/brand/recommend.ts → saveRecommendation); the Design tab reads it
// via `options` and every pick goes through `decide`, which stores the evidence, applies the
// token (tokensVersion+1, dependent courses stale) and schedules the Mubit loop (brandLoop.ts).

/** Design tab: candidates per field with the recommended option first. Null before extraction. */
export const options = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const profile = await latestProfile(ctx, space);
    if (!profile) return null;
    const rec = await currentRecommendation(ctx, space, profile);
    const fields = Object.fromEntries(
      BRAND_FIELDS.map((f) => {
        const r = rec.fields[f];
        return [f, { candidates: r.candidates, recommended: r.recommended, reason: r.reason, source: r.source, current: currentValue(profile, f) }];
      }),
    );
    return { fields, requestId: rec.requestId, tokensVersion: profile.tokensVersion, computedAt: rec.computedAt };
  },
});

type Ctx = MutationCtx;

/** Stores one manager pick with its evidence and applies it to `patch` (callers write the profile). */
async function recordDecision(ctx: Ctx, args: { spaceId: Id<"spaces">; userId: string; space: Doc<"spaces">; profile: Doc<"brand_profiles">; field: BrandField; chosen: string; tokensVersion: number }) {
  const rec = await currentRecommendation(ctx, args.space, args.profile);
  // The server's recommendation is the truth for `accepted` (the client may hold a stale one).
  const d = buildDecision(rec, args.field, args.chosen);
  const decisionId = await ctx.db.insert("brand_decisions", {
    spaceId: args.spaceId,
    ...d,
    companyProfile: rec.companyProfile,
    mubitRequestId: rec.requestId ?? undefined,
    tokensVersion: args.tokensVersion,
    actor: `user:${args.userId}`,
    embedding: rec.embedding,
    embeddingMode: rec.embeddingMode,
  });
  await ctx.scheduler.runAfter(0, internal.brandLoop.send, { decisionId });
  return { decisionId, d, requestId: rec.requestId };
}

/** Brand contract: a token edit marks courses generated against older tokens stale. */
async function staleCourses(ctx: Ctx, spaceId: Id<"spaces">, reason: Record<string, unknown>) {
  const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
  let staled = 0;
  for (const c of courses) {
    if (c.status === "archived") continue;
    await ctx.db.patch(c._id, { needsRefresh: true, ...(c.status === "published" ? { status: "stale" as const } : {}) });
    await audit(ctx, spaceId, "system:brand", "course.needs_refresh", { courseId: c._id, reason: "brand_tokens", ...reason });
    staled++;
  }
  return staled;
}

export const decide = mutation({
  args: { spaceId: v.id("spaces"), field: brandField, chosen: v.string(), recommended: v.optional(v.string()) },
  handler: async (ctx, { spaceId, field, chosen: raw }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const profile = await latestProfile(ctx, space);
    if (!profile) return fail(404, "No brand profile yet — run a scan first");
    const chosen = normaliseChoice(field, raw);
    const tokensVersion = profile.tokensVersion + 1;
    const { decisionId, d, requestId } = await recordDecision(ctx, { spaceId, userId, space, profile, field, chosen, tokensVersion });
    await ctx.db.patch(profile._id, { ...applyToken(profile, field, chosen), tokensVersion });
    const staled = await staleCourses(ctx, spaceId, { field, tokensVersion });
    await audit(ctx, spaceId, `user:${userId}`, "brand.decided", { decisionId, field, chosen, recommended: d.recommended, accepted: d.accepted, source: d.recommendedSource, tokensVersion, mubitRequestId: requestId, coursesStale: staled });
    return { decisionId, accepted: d.accepted, tokensVersion, coursesStale: staled };
  },
});

// ---- theme options (D-34) -------------------------------------------------------------------

/** The theme cards shown after the scan, with the one currently applied. Null before extraction. */
export const themes = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const profile = await latestProfile(ctx, space);
    if (!profile) return null;
    return { themes: (profile.themes ?? []) as Theme[], themeId: profile.themeId ?? null, tokensVersion: profile.tokensVersion };
  },
});

/**
 * The manager picks a theme card: its palette, radius and style become the space's tokens
 * (tokensVersion+1, courses stale). The colour/radius picks are stored as brand decisions, so
 * the Mubit loop learns from theme picks exactly as from Design-tab picks.
 */
export const pickTheme = mutation({
  args: { spaceId: v.id("spaces"), themeId: v.string() },
  handler: async (ctx, { spaceId, themeId }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const profile = await latestProfile(ctx, space);
    if (!profile) return fail(404, "No brand profile yet — run a scan first");
    const theme = ((profile.themes ?? []) as Theme[]).find((t) => t.id === themeId);
    if (!theme) return fail(404, "That theme is not one of this space's options");
    const tokensVersion = profile.tokensVersion + 1;
    const decisions = [];
    for (const field of ["primary", "accent", "radius"] as const) {
      const chosen = field === "radius" ? theme.radius : theme.palette[field];
      if (!chosen) continue;
      decisions.push((await recordDecision(ctx, { spaceId, userId, space, profile, field, chosen: normaliseChoice(field, chosen), tokensVersion })).decisionId);
    }
    const palette = (["primary", "accent", "surface", "text"] as const).map((role) => ({ role, hex: theme.palette[role], name: profile.palette.find((p) => p.role === role)?.name ?? role }));
    await ctx.db.patch(profile._id, { palette, radius: theme.radius, themeId, themeStyle: theme.style, tokensVersion });
    const staled = await staleCourses(ctx, spaceId, { themeId, tokensVersion });
    await audit(ctx, spaceId, `user:${userId}`, "brand.theme_picked", { themeId, style: theme.style, decisions, tokensVersion, coursesStale: staled });
    return { tokensVersion, coursesStale: staled };
  },
});

// ---- worker side (scan time) ----------------------------------------------------------------

/** Past decisions across all spaces for precedent search and the learned ranker. */
export const history = workerQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => recentDecisions(ctx, Math.min(limit ?? 500, 1000)),
});

/** Stores the scan-time recommendation on the space's brand profile (extract_design stores the candidates). */
export const saveRecommendation = workerMutation({
  args: { spaceId: v.id("spaces"), recommendation: v.any(), apply: v.optional(v.boolean()) },
  handler: async (ctx, { spaceId, recommendation, apply }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return fail(404, "Space not found");
    const profile = await latestProfile(ctx, space);
    if (!profile) return { saved: false };
    const rec = recommendation as StoredRecommendation;
    let patch: Record<string, unknown> = { recommendation: rec };
    if (apply) {
      let cur = { palette: profile.palette, typography: profile.typography, radius: profile.radius };
      for (const f of BRAND_FIELDS) if (rec.fields[f]?.recommended) cur = { ...cur, ...applyToken(cur, f as BrandField, rec.fields[f].recommended) };
      patch = { ...patch, ...cur };
    }
    await ctx.db.patch(profile._id, patch);
    await audit(ctx, spaceId, "system:brand", "brand.recommended", {
      brandProfileId: profile._id,
      requestId: rec.requestId,
      picks: Object.fromEntries(BRAND_FIELDS.map((f) => [f, { value: rec.fields[f]?.recommended, source: rec.fields[f]?.source }])),
    });
    return { saved: true };
  },
});

/** extract_design: theme options from the profile as recommended (call after saveRecommendation). */
export const saveThemes = workerMutation({
  args: { spaceId: v.id("spaces"), style: v.optional(v.any()) },
  handler: async (ctx, { spaceId, style }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return fail(404, "Space not found");
    const profile = await latestProfile(ctx, space);
    if (!profile) return { themes: 0 };
    const hex = (role: string, fallback: string) => profile.palette.find((p) => p.role === role)?.hex ?? fallback;
    const logo = profile.logoRefs.find((l) => l.kind !== "favicon") ?? profile.logoRefs[0];
    const themes = buildThemes({
      primary: hex("primary", "#2f6bff"),
      accent: hex("accent", "#ff5c39"),
      surface: hex("surface", "#ffffff"),
      text: hex("text", "#111114"),
      headingFont: profile.typography.heading.family,
      bodyFont: profile.typography.body.family,
      radius: profile.radius ?? null,
      style: (style as StyleCues | undefined) ?? null,
      logoUrl: logo?.url ?? null,
      logoTone: logo?.tone ?? null,
    });
    // The recommended (signature) theme is applied until the manager picks another.
    await ctx.db.patch(profile._id, { themes, themeId: themes[0].id, themeStyle: themes[0].style });
    return { themes: themes.length, styles: themes.map((t) => t.style) };
  },
});

// ---- Mubit loop bookkeeping (convex/brandLoop.ts) -------------------------------------------

export const loopContext = internalQuery({
  args: { decisionId: v.id("brand_decisions") },
  handler: async (ctx, { decisionId }) => ctx.db.get(decisionId),
});

export const recordLoop = internalMutation({
  args: {
    decisionId: v.id("brand_decisions"),
    feedback: v.object({ sink: v.string(), delivered: v.boolean(), detail: v.string() }),
    memory: v.object({ status: v.union(v.literal("remembered"), v.literal("skipped"), v.literal("failed")), detail: v.string() }),
  },
  handler: async (ctx, { decisionId, feedback, memory }) => {
    const d = await ctx.db.get(decisionId);
    if (!d) return;
    await ctx.db.patch(decisionId, { loop: { feedback, memory, at: Date.now() } });
    await audit(ctx, d.spaceId, "system:mubit", "brand.feedback", { decisionId, requestId: d.mubitRequestId ?? null, verdict: d.accepted ? "approve" : "correct", ...feedback });
    await audit(ctx, d.spaceId, "system:mubit", "brand.memory", { decisionId, ...memory });
  },
});
