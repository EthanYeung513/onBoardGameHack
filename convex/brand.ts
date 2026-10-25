import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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

export const decide = mutation({
  args: { spaceId: v.id("spaces"), field: brandField, chosen: v.string(), recommended: v.optional(v.string()) },
  handler: async (ctx, { spaceId, field, chosen: raw }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const profile = await latestProfile(ctx, space);
    if (!profile) return fail(404, "No brand profile yet — run a scan first");
    const chosen = normaliseChoice(field, raw);
    const rec = await currentRecommendation(ctx, space, profile);
    // The server's recommendation is the truth for `accepted` (the client may hold a stale one).
    const d = buildDecision(rec, field, chosen);
    const tokensVersion = profile.tokensVersion + 1;
    await ctx.db.patch(profile._id, { ...applyToken(profile, field, chosen), tokensVersion });

    const decisionId = await ctx.db.insert("brand_decisions", {
      spaceId,
      ...d,
      companyProfile: rec.companyProfile,
      mubitRequestId: rec.requestId ?? undefined,
      tokensVersion,
      actor: `user:${userId}`,
      embedding: rec.embedding,
      embeddingMode: rec.embeddingMode,
    });

    // Brand contract: a token edit marks courses generated against older tokens stale.
    const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    let staled = 0;
    for (const c of courses) {
      if (c.status === "archived") continue;
      await ctx.db.patch(c._id, { needsRefresh: true, ...(c.status === "published" ? { status: "stale" as const } : {}) });
      await audit(ctx, spaceId, "system:brand", "course.needs_refresh", { courseId: c._id, reason: "brand_tokens", field, tokensVersion });
      staled++;
    }
    await audit(ctx, spaceId, `user:${userId}`, "brand.decided", { decisionId, field, chosen, recommended: d.recommended, accepted: d.accepted, source: d.recommendedSource, tokensVersion, mubitRequestId: rec.requestId, coursesStale: staled });
    await ctx.scheduler.runAfter(0, internal.brandLoop.send, { decisionId });
    return { decisionId, accepted: d.accepted, tokensVersion, coursesStale: staled };
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
