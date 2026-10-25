import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { CoursePatch } from "../src/lib/flow/course-patch";
import { PACK_TYPES } from "../src/lib/flow/course-packs";
import type { CourseSpec } from "../src/lib/flow/course-spec";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { DRIFT_ACTOR, patchForSpace, syncCourseFacts } from "./lib/courses";
import { fail } from "./lib/errors";
import { workerMutation } from "./lib/worker";

// Manager-facing course functions (F36 + the dashboard/editor read side). Generation itself is the
// `generate_courses` worker stage; these enqueue it on the manager's confirm and apply validated
// edits. Courses never regenerate on their own — drift only flags `needsRefresh`/`staleStepIds`.

/** One unit of course work in a `generate_courses` job cursor. No `stepIds` = rebuild the course. */
export type CourseTarget = { packType: string; stepIds?: string[]; requestedBy?: string };

async function loadCourse(ctx: QueryCtx, courseId: Id<"courses">) {
  const course = await ctx.db.get(courseId);
  if (!course) return fail(404, "Course not found");
  const access = await requireRole(ctx, course.spaceId, MANAGERS);
  return { course, ...access };
}

/** Manual course jobs (not part of a scan) for the space that haven't finished yet. */
async function openCourseJobs(ctx: QueryCtx, spaceId: Id<"spaces">) {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .filter((q) => q.and(q.eq(q.field("stage"), "generate_courses"), q.eq(q.field("scanId"), undefined)))
    .collect();
  return jobs.filter((j) => j.status === "queued" || j.status === "running");
}

function targetsOf(job: Doc<"jobs">): CourseTarget[] {
  return ((job.cursor as { targets?: CourseTarget[] } | null)?.targets ?? []).slice();
}

/** Merge into a still-queued manual job, or queue a new one. A full rebuild absorbs step refreshes. */
async function requestCourseJob(ctx: MutationCtx, spaceId: Id<"spaces">, target: CourseTarget) {
  const queued = (await openCourseJobs(ctx, spaceId)).find((j) => j.status === "queued");
  if (!queued) {
    return await ctx.db.insert("jobs", { spaceId, stage: "generate_courses", status: "queued", progress: 0, attempt: 0, cursor: { targets: [target] }, runAfter: Date.now() });
  }
  const targets = targetsOf(queued);
  const same = targets.find((t) => t.packType === target.packType);
  if (!same) targets.push(target);
  else if (!same.stepIds || !target.stepIds) delete same.stepIds;
  else same.stepIds = [...new Set([...same.stepIds, ...target.stepIds])];
  await ctx.db.patch(queued._id, { cursor: { ...(queued.cursor ?? {}), targets } });
  return queued._id;
}

const packOrder = (packType: string) => {
  const i = PACK_TYPES.indexOf(packType as (typeof PACK_TYPES)[number]);
  return i < 0 ? PACK_TYPES.length : i;
};

/** Dashboard "Generate course": queue every default pack the space doesn't have yet (F20/F25). */
export const generate = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId } = await requireRole(ctx, spaceId, MANAGERS);
    const existing = new Set((await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect()).map((c) => c.packType));
    const missing = PACK_TYPES.filter((p) => !existing.has(p));
    for (const packType of missing) await requestCourseJob(ctx, spaceId, { packType, requestedBy: `user:${userId}` });
    if (missing.length) await audit(ctx, spaceId, `user:${userId}`, "courses.generate_requested", { packs: missing });
    return { queued: missing };
  },
});

/** Dashboard Courses tab: the space's courses in the mockup's order. */
export const list = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    const pending = (await openCourseJobs(ctx, spaceId)).flatMap(targetsOf).map((t) => t.packType);
    return courses
      .sort((a, b) => packOrder(a.packType) - packOrder(b.packType))
      .map((c) => {
        const spec = c.spec as CourseSpec;
        return {
          id: c._id,
          packType: c.packType,
          title: c.title,
          icon: c.icon,
          building: c.building,
          game: c.game,
          desc: spec?.desc ?? null,
          lessons: (spec?.steps ?? []).filter((s) => s.kind === "lesson").map((s) => s.title),
          status: c.status,
          mode: c.mode ?? null,
          needsRefresh: c.needsRefresh,
          staleStepIds: c.staleStepIds ?? [],
          version: c.version,
          publishedVersion: c.publishedVersion ?? null,
          regenerating: pending.includes(c.packType),
        };
      });
  },
});

/** Course page / editor: the spec plus the facts it teaches (with their current status). */
export const get = query({
  args: { courseId: v.id("courses") },
  handler: async (ctx, { courseId }) => {
    const { course } = await loadCourse(ctx, courseId);
    const rows = await ctx.db.query("course_facts").withIndex("by_course", (q) => q.eq("courseId", courseId)).collect();
    const facts = [];
    for (const factId of new Set(rows.map((r) => r.factId))) {
      const f = await ctx.db.get(factId);
      if (f) facts.push({ id: f._id, text: f.text, category: f.category, status: f.status, stepIds: rows.filter((r) => r.factId === factId).map((r) => r.stepId ?? null) });
    }
    const regenerating = (await openCourseJobs(ctx, course.spaceId)).some((j) => targetsOf(j).some((t) => t.packType === course.packType));
    return { ...course, staleStepIds: course.staleStepIds ?? [], facts, regenerating };
  },
});

/** F36: rebuild the whole course from the brain — only ever called on the manager's confirm. */
export const regenerate = mutation({
  args: { courseId: v.id("courses") },
  handler: async (ctx, { courseId }) => {
    const { course, userId } = await loadCourse(ctx, courseId);
    if (course.status === "archived") return fail(409, "Archived courses can't be regenerated");
    const jobId = await requestCourseJob(ctx, course.spaceId, { packType: course.packType, requestedBy: `user:${userId}` });
    await audit(ctx, course.spaceId, `user:${userId}`, "course.regenerate_requested", { courseId, packType: course.packType, jobId, staleStepIds: course.staleStepIds ?? [] });
    return { jobId };
  },
});

/** F36 step-level refresh: rewrite only the given (stale) steps through a validated patch. */
export const regenerateSteps = mutation({
  args: { courseId: v.id("courses"), stepIds: v.array(v.string()) },
  handler: async (ctx, { courseId, stepIds }) => {
    const { course, userId } = await loadCourse(ctx, courseId);
    if (course.status === "archived") return fail(409, "Archived courses can't be regenerated");
    const known = new Set(((course.spec as CourseSpec)?.steps ?? []).map((s) => s.id));
    const unknown = stepIds.filter((id) => !known.has(id));
    if (stepIds.length === 0 || unknown.length) return fail(422, unknown.length ? `No step with id ${unknown.map((id) => `"${id}"`).join(", ")}` : "Pick at least one step");
    const jobId = await requestCourseJob(ctx, course.spaceId, { packType: course.packType, stepIds: [...new Set(stepIds)], requestedBy: `user:${userId}` });
    await audit(ctx, course.spaceId, `user:${userId}`, "course.regenerate_requested", { courseId, packType: course.packType, jobId, stepIds });
    return { jobId };
  },
});

const patchArg = v.object({ op: v.union(v.literal("set"), v.literal("add"), v.literal("remove")), path: v.string(), value: v.optional(v.any()) });

/** Editor / assistant edits: 409 on a stale version, 422 when the result breaks the course rules. */
export const applyPatch = mutation({
  args: { courseId: v.id("courses"), version: v.number(), patches: v.array(patchArg) },
  handler: async (ctx, { courseId, version, patches }) => {
    const { course, userId } = await loadCourse(ctx, courseId);
    if (course.version !== version) return fail(409, `This course changed since you opened it (now v${course.version}). Reload to edit.`);
    const r = await patchForSpace(ctx, course.spaceId, course.spec as CourseSpec, patches as CoursePatch[]);
    if (!r.ok) return fail(422, r.errors.slice(0, 5).join("; "));
    const next = course.version + 1;
    // Published content stays as published (publishedSpec) until the course is published again.
    // Stale steps the edit removed are no longer stale; the course is refreshed once none remain.
    const before = course.staleStepIds ?? [];
    const staleStepIds = before.filter((id) => r.spec.steps.some((s) => s.id === id));
    const refreshed = before.length > 0 && staleStepIds.length === 0;
    await ctx.db.patch(courseId, {
      spec: r.spec,
      title: r.spec.title,
      icon: r.spec.icon,
      building: r.spec.building,
      game: r.spec.game,
      version: next,
      staleStepIds,
      ...(refreshed ? { needsRefresh: false } : {}),
    });
    await syncCourseFacts(ctx, course, r.spec);
    await audit(ctx, course.spaceId, `user:${userId}`, "course.patched", { courseId, fromVersion: version, toVersion: next, summary: r.summary ?? "" });
    return { version: next };
  },
});

/**
 * D-36: after the drift cascade lands a company change, rewrite just the stale steps of every
 * affected course in the background (the "New" badges); nothing reaches hires until the manager
 * clicks "Update courses". Called by the cascade stage when it finishes.
 */
export const refreshAfterDrift = workerMutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    let queued = 0;
    for (const c of courses) {
      const stepIds = c.staleStepIds ?? [];
      if (c.status === "archived" || !c.needsRefresh || !stepIds.length) continue;
      await requestCourseJob(ctx, spaceId, { packType: c.packType, stepIds, requestedBy: DRIFT_ACTOR });
      await audit(ctx, spaceId, DRIFT_ACTOR, "course.refresh_queued", { courseId: c._id, course: c.title, stepIds });
      queued++;
    }
    return { queued };
  },
});
