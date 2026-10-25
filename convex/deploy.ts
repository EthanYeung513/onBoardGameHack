import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { workerMutation, workerQuery } from "./lib/worker";
import { enqueue } from "./pipeline";

// Generate → deploy (D-33). The manager's Generate button calls `deployOnboarding`; the worker's
// `deploy` stage packages the space's onboarding world and deploys it as the company's own
// Vercel project (or the labelled stand-in served by this app at /o/<slug>), then records
// `spaces.deployUrl`.

/** Raw content for the onboarding world (shaped by src/lib/onboarding/content.ts). */
async function onboardingInput(ctx: QueryCtx, space: Doc<"spaces">) {
  const brand = space.brandProfileId ? await ctx.db.get(space.brandProfileId) : null;
  const pick = (role: string) => brand?.palette.find((p) => p.role === role)?.hex;
  const courses = (await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", space._id)).collect()).filter((c) => c.status !== "archived");
  const approved = await ctx.db.query("facts").withIndex("by_space_status", (q) => q.eq("spaceId", space._id).eq("status", "approved")).take(200);
  const rejected = await ctx.db.query("facts").withIndex("by_space_status", (q) => q.eq("spaceId", space._id).eq("status", "rejected")).take(20);
  const entityCache = new Map<Id<"entities">, Doc<"entities"> | null>();
  const facts = await Promise.all(
    approved.map(async (f) => {
      let e: Doc<"entities"> | null = null;
      if (f.entityId) {
        if (!entityCache.has(f.entityId)) entityCache.set(f.entityId, await ctx.db.get(f.entityId));
        e = entityCache.get(f.entityId) ?? null;
      }
      return { text: f.text, category: f.category, entityName: e?.name, entityType: e?.type };
    }),
  );
  const rewards = (await ctx.db.query("rewards").withIndex("by_space", (q) => q.eq("spaceId", space._id)).collect()).filter((r) => r.active);
  return {
    space: { name: space.name, host: space.host, slug: space.slug, mode: space.mode },
    brand: brand
      ? {
          primary: pick("primary"),
          accent: pick("accent"),
          surface: pick("surface"),
          text: pick("text"),
          voice: brand.voice,
          headingFont: brand.typography.heading.family,
          bodyFont: brand.typography.body.family,
          logoUrl: brand.logoRefs.find((l) => l.kind !== "favicon")?.url ?? null,
        }
      : null,
    // The current spec (not a publish snapshot): when the brain changes and a course refreshes,
    // the hire's world follows on its next load (the Mubit continuous-learning loop, end to end).
    courses: courses.map((c) => ({
      packType: c.packType,
      title: c.title,
      icon: c.icon,
      building: c.building,
      game: c.game,
      spec: c.spec,
      desc: typeof (c.spec as { desc?: unknown })?.desc === "string" ? (c.spec as { desc: string }).desc : undefined,
      staleSteps: c.staleStepIds?.length ?? 0,
    })),
    facts,
    rejected: rejected.map((f) => ({ text: f.text, category: f.category })),
    rewards: rewards.map((r) => ({ name: r.name, costCoins: r.costCoins })),
  };
}

/** The manager's Generate push: (re)deploy this company's onboarding world. */
export const deployOnboarding = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const course = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).first();
    if (!course) fail(422, "Generate at least one course before publishing the onboarding world");
    if (space.deployState === "building") return { queued: false };
    await ctx.db.patch(spaceId, { deployState: "building", deployError: undefined });
    await enqueue(ctx, { spaceId }, "deploy", {});
    await audit(ctx, spaceId, `user:${userId}`, "deploy.requested", { previousUrl: space.deployUrl ?? null });
    return { queued: true };
  },
});

export const bundleInput = workerQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return fail(404, "Space not found");
    return await onboardingInput(ctx, space);
  },
});

export const recordDeploy = workerMutation({
  args: {
    spaceId: v.id("spaces"),
    ok: v.boolean(),
    mode: v.union(v.literal("vercel"), v.literal("stand-in")),
    url: v.optional(v.string()),
    projectId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { spaceId, ok, mode, url, projectId, error }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return fail(404, "Space not found");
    if (ok) {
      await ctx.db.patch(spaceId, { deployState: "ready", deployMode: mode, deployUrl: url, deployProjectId: projectId, deployedAt: Date.now(), deployError: undefined, publishedAt: space.publishedAt ?? Date.now() });
    } else {
      await ctx.db.patch(spaceId, { deployState: "error", deployError: error });
    }
    await audit(ctx, spaceId, "system:deploy", ok ? "deploy.succeeded" : "deploy.failed", { mode, url, projectId, error });
  },
});

/** Public: the stand-in onboarding world's content for /o/<slug> (only once published). */
export const published = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const space = await ctx.db.query("spaces").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
    if (!space || !space.deployedAt) return null;
    return { input: await onboardingInput(ctx, space), mode: space.deployMode ?? "stand-in", deployedAt: space.deployedAt };
  },
});
