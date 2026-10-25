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
  // Facts the courses teach first (a refreshed step's new fact must reach the world), then the
  // newest approved ones, up to 200.
  const cited: Doc<"facts">[] = [];
  for (const c of courses) {
    for (const cf of await ctx.db.query("course_facts").withIndex("by_course", (q) => q.eq("courseId", c._id)).collect()) {
      if (cited.some((f) => f._id === cf.factId)) continue;
      const f = await ctx.db.get(cf.factId);
      if (f?.status === "approved") cited.push(f);
    }
  }
  const newest = await ctx.db.query("facts").withIndex("by_space_status", (q) => q.eq("spaceId", space._id).eq("status", "approved")).order("desc").take(200);
  const approved = [...cited, ...newest.filter((f) => !cited.some((c) => c._id === f._id))].slice(0, 200);
  const rejected = await ctx.db.query("facts").withIndex("by_space_status", (q) => q.eq("spaceId", space._id).eq("status", "rejected")).take(20);
  const entityCache = new Map<Id<"entities">, Doc<"entities"> | null>();
  const facts = await Promise.all(
    approved.map(async (f) => {
      let e: Doc<"entities"> | null = null;
      if (f.entityId) {
        if (!entityCache.has(f.entityId)) entityCache.set(f.entityId, await ctx.db.get(f.entityId));
        e = entityCache.get(f.entityId) ?? null;
      }
      return { id: f._id as string, text: f.text, category: f.category, entityName: e?.name, entityType: e?.type };
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
    // The current spec; the hire's world serves a snapshot of this taken at each push (D-36).
    courses: courses.map((c) => ({
      packType: c.packType,
      title: c.title,
      icon: c.icon,
      building: c.building,
      game: c.game,
      spec: c.spec,
      desc: typeof (c.spec as { desc?: unknown })?.desc === "string" ? (c.spec as { desc: string }).desc : undefined,
      staleSteps: c.staleStepIds?.length ?? 0,
      version: c.version,
    })),
    facts,
    rejected: rejected.map((f) => ({ text: f.text, category: f.category })),
    rewards: rewards.map((r) => ({ name: r.name, costCoins: r.costCoins })),
  };
}

async function openDeployJob(ctx: QueryCtx, spaceId: Id<"spaces">) {
  return await ctx.db
    .query("jobs")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .filter((q) => q.and(q.eq(q.field("stage"), "deploy"), q.or(q.eq(q.field("status"), "queued"), q.eq(q.field("status"), "running"))))
    .first();
}

/** The Publish button's state: building only while a deploy job is actually queued or running. */
export const status = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const open = await openDeployJob(ctx, spaceId);
    return { building: Boolean(open), error: space.deployState === "error" ? (space.deployError ?? "The last publish failed") : null };
  },
});

/** The manager's Generate push: (re)deploy this company's onboarding world. */
export const deployOnboarding = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const course = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).first();
    if (!course) fail(422, "Generate at least one course before publishing the onboarding world");
    // A "building" flag with no deploy job left (failed, stalled, never claimed) must not lock
    // the button: only an open job means a push is really in flight.
    if (space.deployState === "building" && (await openDeployJob(ctx, spaceId))) return { queued: false };
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
      const at = Date.now();
      await ctx.db.patch(spaceId, { deployState: "ready", deployMode: mode, deployUrl: url, deployProjectId: projectId, deployedAt: at, deployError: undefined, publishedAt: space.publishedAt ?? at });
      // D-36: the hire's world now serves exactly this content until the manager's next push, and
      // the "New" badges (changes the manager has now published) clear.
      for (const old of await ctx.db.query("world_snapshots").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect()) await ctx.db.delete(old._id);
      await ctx.db.insert("world_snapshots", { spaceId, input: await onboardingInput(ctx, space), at });
      for (const c of await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect()) {
        if (c.newStepIds?.length) await ctx.db.patch(c._id, { newStepIds: [] });
      }
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
    // The content as of the manager's last push (D-36); spaces published before snapshots existed
    // fall back to the live content.
    const snapshot = await ctx.db.query("world_snapshots").withIndex("by_space", (q) => q.eq("spaceId", space._id)).first();
    return { input: snapshot?.input ?? (await onboardingInput(ctx, space)), mode: space.deployMode ?? "stand-in", deployedAt: space.deployedAt };
  },
});

/**
 * D-36 "Update courses": what changed since the manager's last push. Mubit's loop detects company
 * changes (connector drift → stale facts → refreshed course steps); the manager sees what is new
 * and decides when the hire's world gets it. Null when the space isn't published yet.
 */
export const pendingUpdates = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    if (!space.deployedAt) return null;
    const snapshot = await ctx.db.query("world_snapshots").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).first();
    const published = new Map<string, number | undefined>(
      ((snapshot?.input as { courses?: { packType: string; version?: number }[] } | undefined)?.courses ?? []).map((c) => [c.packType, c.version]),
    );
    const courses = (await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect()).filter((c) => c.status !== "archived");
    const changed = courses
      .filter((c) => (snapshot ? published.get(c.packType) !== c.version : (c.newStepIds?.length ?? 0) > 0))
      .map((c) => ({ courseId: c._id, title: c.title, newSteps: c.newStepIds?.length ?? 0, isNew: snapshot ? !published.has(c.packType) : false }));
    const refreshing = courses.filter((c) => c.needsRefresh).length;
    return { changed, refreshing, deployedAt: space.deployedAt, building: Boolean(await openDeployJob(ctx, spaceId)) };
  },
});
