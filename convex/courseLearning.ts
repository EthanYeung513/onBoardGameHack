import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { editSignals, outline, patchSummary } from "../src/lib/courses/edits";
import type { CoursePatch } from "../src/lib/flow/course-patch";
import type { CourseSpec } from "../src/lib/flow/course-spec";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { workerQuery } from "./lib/worker";

// Mubit learns how the manager edits courses (the course-page assistant). The assistant action
// (courseAssist.assist) applies its patches through courses.applyPatch, then `recordEdit`
// stores the edit as evidence and schedules the Mubit loop: feedback keyed by the request id,
// memory remember, and a `course.preferences` distillation. An hourly cron re-distils any space
// with edits newer than its preferences. generate_courses reads them via `forGeneration`.

/** How many recent edits a distillation reads. */
export const DISTIL_WINDOW = 30;

async function currentPreferences(ctx: QueryCtx, spaceId: Id<"spaces">) {
  return ctx.db.query("course_preferences").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").first();
}

/** The assistant's input: role-checked course, approved facts and learned preferences. */
export const assistContext = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, { courseId }) => {
    const course = await ctx.db.get(courseId);
    if (!course) return fail(404, "Course not found");
    const { userId, space } = await requireRole(ctx, course.spaceId, MANAGERS);
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_space_status", (q) => q.eq("spaceId", course.spaceId).eq("status", "approved"))
      .take(1000);
    const prefs = await currentPreferences(ctx, course.spaceId);
    return {
      userId: userId as string,
      company: space.name,
      spaceId: course.spaceId,
      packType: course.packType,
      version: course.version,
      spec: course.spec as CourseSpec,
      facts: facts.map((f) => ({ id: f._id as string, category: f.category, text: f.text })),
      preferences: (prefs?.items ?? []).map((p) => p.text),
    };
  },
});

/** Course page "Learned from your edits": the space's current preferences. */
export const preferences = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const prefs = await currentPreferences(ctx, spaceId);
    if (!prefs) return null;
    return { items: prefs.items.map((p) => p.text), basedOnEdits: prefs.basedOnEdits, mode: prefs.mode, updatedAt: prefs.updatedAt };
  },
});

/** Called by the assist action after courses.applyPatch succeeded: store the evidence, start the loop. */
export const recordEdit = internalMutation({
  args: {
    courseId: v.id("courses"),
    userId: v.string(),
    instruction: v.string(),
    reply: v.string(),
    patches: v.array(v.any()),
    before: v.any(),
    fromVersion: v.number(),
    mode: v.union(v.literal("live"), v.literal("offline")),
    mubitRequestId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const course = await ctx.db.get(a.courseId);
    if (!course) return fail(404, "Course not found");
    const before = a.before as CourseSpec;
    const after = course.spec as CourseSpec;
    const actor = `user:${a.userId}`;
    const editId = await ctx.db.insert("course_edits", {
      spaceId: course.spaceId,
      courseId: a.courseId,
      packType: course.packType,
      instruction: a.instruction.slice(0, 500),
      reply: a.reply.slice(0, 600),
      patchSummary: patchSummary(a.patches as CoursePatch[], before, after),
      signals: editSignals(before, after),
      before: outline(before),
      after: outline(after),
      fromVersion: a.fromVersion,
      toVersion: course.version,
      accepted: true,
      mode: a.mode,
      mubitRequestId: a.mubitRequestId,
      actor,
    });
    await ctx.scheduler.runAfter(0, internal.courseAssist.loop, { editId });
    await audit(ctx, course.spaceId, actor, "course.assistant_edit", { courseId: a.courseId, editId, mode: a.mode, mubitRequestId: a.mubitRequestId });
    return editId;
  },
});

// ---- Mubit loop bookkeeping (convex/courseAssist.ts) -----------------------------------------

export const loopContext = internalQuery({
  args: { editId: v.id("course_edits") },
  handler: async (ctx, { editId }) => ctx.db.get(editId),
});

export const recordLoop = internalMutation({
  args: {
    editId: v.id("course_edits"),
    feedback: v.object({ sink: v.string(), delivered: v.boolean(), detail: v.string() }),
    memory: v.object({ status: v.union(v.literal("remembered"), v.literal("skipped"), v.literal("failed")), detail: v.string() }),
  },
  handler: async (ctx, { editId, feedback, memory }) => {
    const edit = await ctx.db.get(editId);
    if (!edit) return;
    await ctx.db.patch(editId, { loop: { feedback, memory, at: Date.now() } });
    await audit(ctx, edit.spaceId, "system:mubit", "course.learning_loop", { editId, feedback, memory });
  },
});

/** The distiller's input, or null when no edit is newer than the stored preferences. */
export const distilContext = internalQuery({
  args: { spaceId: v.id("spaces"), force: v.optional(v.boolean()) },
  handler: async (ctx, { spaceId, force }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return null;
    const edits = await ctx.db.query("course_edits").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").take(DISTIL_WINDOW);
    if (!edits.length) return null;
    const prefs = await currentPreferences(ctx, spaceId);
    if (!force && prefs && prefs.lastEditAt >= edits[0]._creationTime) return null;
    return {
      company: space.name,
      host: space.host,
      lastEditAt: edits[0]._creationTime,
      current: (prefs?.items ?? []).map((p) => p.text),
      edits: edits.reverse().map((e) => ({ id: e._id as string, packType: e.packType, instruction: e.instruction, summary: e.patchSummary, signals: e.signals, before: e.before, after: e.after })),
    };
  },
});

export const savePreferences = internalMutation({
  args: {
    spaceId: v.id("spaces"),
    items: v.array(v.object({ text: v.string(), evidenceEditIds: v.array(v.string()) })),
    basedOnEdits: v.number(),
    lastEditAt: v.number(),
    mode: v.union(v.literal("live"), v.literal("offline")),
    mubitRequestId: v.optional(v.string()),
    recalled: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = { ...a, updatedAt: Date.now() };
    const prev = await currentPreferences(ctx, a.spaceId);
    if (prev) await ctx.db.patch(prev._id, row);
    else await ctx.db.insert("course_preferences", row);
    await audit(ctx, a.spaceId, "system:mubit", "course.preferences_learned", { items: a.items.map((i) => i.text), basedOnEdits: a.basedOnEdits, mode: a.mode, mubitRequestId: a.mubitRequestId });
  },
});

/** Spaces with edits newer than their preferences (hourly cron). */
export const spacesDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const recent = await ctx.db.query("course_edits").order("desc").take(500);
    const newest = new Map<Id<"spaces">, number>();
    for (const e of recent) if (!newest.has(e.spaceId)) newest.set(e.spaceId, e._creationTime);
    const due: Id<"spaces">[] = [];
    for (const [spaceId, at] of newest) {
      const prefs = await currentPreferences(ctx, spaceId);
      if (!prefs || prefs.lastEditAt < at) due.push(spaceId);
    }
    return due;
  },
});

/** generate_courses: what this space's manager prefers (worker side). */
export const forGeneration = workerQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const space = await ctx.db.get(spaceId);
    const prefs = await currentPreferences(ctx, spaceId);
    return { company: space?.name ?? "", host: space?.host ?? "", preferences: (prefs?.items ?? []).map((p) => p.text) };
  },
});
