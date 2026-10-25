import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import { MANAGERS, requireRole } from "./lib/access";
import { approvedFacts, CAP, displayName, loadSpaceActivity, scoredStepCount } from "./lib/progress";
import { GAP_CATEGORIES, GAP_THRESHOLD, insightsFor } from "./lib/insights";

// dashboard.html on real data (PRD F23–F30). Every query asserts a manager role and reads only
// the space's own rows through `by_space*` indexes, capped by CAP. Empty spaces return zeros and
// empty lists — the UI shows the mockup's empty states, never seeded people.

const spaceArg = { spaceId: v.id("spaces") };

function hireRow(r: Awaited<ReturnType<typeof loadSpaceActivity>>["hires"][number]) {
  const { hire } = r;
  return {
    _id: hire._id,
    name: displayName(hire),
    email: hire.email,
    status: hire.status,
    coins: hire.coins,
    joinedAt: hire.joinedAt ?? hire._creationTime,
    progress: r.progress,
    coursesDone: r.coursesDone,
    started: r.perCourse.size,
  };
}

/** Overview + Team tabs: KPIs and one row per hire. */
export const overview = query({
  args: spaceArg,
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const [{ hires, courses }, facts] = await Promise.all([loadSpaceActivity(ctx, spaceId), approvedFacts(ctx, spaceId)]);
    const done = hires.filter((h) => h.hire.status === "complete" || (courses.length > 0 && h.progress === 100)).length;
    return {
      kpis: {
        facts: facts.length,
        team: hires.length,
        courses: courses.length,
        onTrack: hires.length ? Math.round((done / hires.length) * 100) : 0,
      },
      coursesTotal: courses.length,
      hires: hires.map(hireRow),
    };
  },
});

function describeCourse(course: Doc<"courses">) {
  const spec = (course.spec ?? {}) as { description?: string; desc?: string; steps?: { id?: string; kind?: string; title?: string; body?: string }[] };
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  const welcome = steps.find((s) => s.kind === "welcome");
  const staleStepIds = course.staleStepIds ?? [];
  return {
    _id: course._id,
    title: course.title,
    icon: course.icon,
    building: course.building,
    game: course.game,
    status: course.status,
    needsRefresh: course.needsRefresh,
    staleSteps: staleStepIds.length,
    /** D-36: steps rewritten for a detected company change, not yet pushed to hires ("New"). */
    newSteps: (course.newStepIds ?? []).length,
    newLessons: steps.filter((s) => s.id && (course.newStepIds ?? []).includes(s.id) && s.title).map((s) => s.title as string),
    desc: spec.description ?? spec.desc ?? welcome?.body ?? "",
    lessons: steps.filter((s) => s.kind && !["welcome", "done"].includes(s.kind) && s.title).map((s) => s.title as string),
    steps: scoredStepCount(course.spec),
  };
}

/** Courses tab: curriculum cards (F36 "Needs refresh" comes from `needsRefresh`/`staleStepIds`). */
export const courses = query({
  args: spaceArg,
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const rows = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.courses);
    return rows.filter((c) => c.status !== "archived").map(describeCourse);
  },
});

async function pendingDiffsByConnector(ctx: QueryCtx, spaceId: Id<"spaces">) {
  const pending = await ctx.db
    .query("diff_events")
    .withIndex("by_space_processed", (q) => q.eq("spaceId", spaceId).eq("processedAt", undefined))
    .take(500);
  const counts = new Map<Id<"connectors">, number>();
  const items = new Map<Id<"source_items">, Id<"connectors"> | undefined>();
  for (const e of pending) {
    if (!items.has(e.sourceItemId)) items.set(e.sourceItemId, (await ctx.db.get(e.sourceItemId))?.connectorId);
    const connectorId = items.get(e.sourceItemId);
    if (connectorId) counts.set(connectorId, (counts.get(connectorId) ?? 0) + 1);
  }
  return counts;
}

/** Tools tab: brain size + each connector's real status, last sync, error and queued changes. */
export const tools = query({
  args: spaceArg,
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const [facts, connectors, pending] = await Promise.all([
      approvedFacts(ctx, spaceId),
      ctx.db.query("connectors").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.connectors),
      pendingDiffsByConnector(ctx, spaceId),
    ]);
    return {
      facts: facts.length,
      connectors: connectors.map((c) => ({
        _id: c._id,
        type: c.type,
        status: c.status,
        label: c.label ?? null,
        lastSyncedAt: c.lastSyncedAt ?? null,
        error: c.error ?? null,
        pendingChanges: pending.get(c._id) ?? 0,
      })),
    };
  },
});

/** Analytics tab: completion per course, coins per hire, per-hire scores, knowledge gaps. */
export const analytics = query({
  args: spaceArg,
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const [{ hires, courses }, facts, redemptions, rewards] = await Promise.all([
      loadSpaceActivity(ctx, spaceId),
      approvedFacts(ctx, spaceId),
      ctx.db.query("redemptions").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(1000),
      ctx.db.query("rewards").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(200),
    ]);
    const cost = new Map(rewards.map((r) => [r._id, r.costCoins]));
    const spent = new Map<Id<"hires">, number>();
    for (const r of redemptions) if (r.status !== "declined") spent.set(r.hireId, (spent.get(r.hireId) ?? 0) + (cost.get(r.rewardId) ?? 0));
    const byCategory = new Map<string, number>();
    for (const f of facts) byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    return {
      courses: courses.map((c) => {
        const done = hires.filter((h) => h.perCourse.get(c._id)?.done).length;
        return { _id: c._id, title: c.title, completion: hires.length ? Math.round((done / hires.length) * 100) : 0 };
      }),
      hires: hires.map((h) => ({
        _id: h.hire._id,
        name: displayName(h.hire),
        coins: h.hire.coins,
        redeemed: spent.get(h.hire._id) ?? 0,
        progress: h.progress,
        scores: courses.map((c) => h.perCourse.get(c._id)?.score ?? null),
      })),
      gaps: GAP_CATEGORIES.map((category) => ({ category, count: byCategory.get(category) ?? 0 })).filter((g) => g.count < GAP_THRESHOLD),
    };
  },
});

/** AI FAB (F30): deterministic insights over the same aggregates — no LLM involved. */
export const insights = query({
  args: spaceArg,
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const [activity, facts, connectors] = await Promise.all([
      loadSpaceActivity(ctx, spaceId),
      approvedFacts(ctx, spaceId),
      ctx.db.query("connectors").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.connectors),
    ]);
    return insightsFor({ ...activity, facts, connectors, now: Date.now() });
  },
});
