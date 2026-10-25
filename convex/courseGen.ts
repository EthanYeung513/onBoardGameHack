import { v } from "convex/values";
import type { CoursePatch } from "../src/lib/flow/course-patch";
import { packFor } from "../src/lib/flow/course-packs";
import type { CourseSpec } from "../src/lib/flow/course-spec";
import { citedIds, patchForSpace, republishIfLive, syncCourseFacts, validateForSpace } from "./lib/courses";
import { fail } from "./lib/errors";
import { workerMutation, workerQuery } from "./lib/worker";

// Worker side of the `generate_courses` stage (src/worker/stages/generate-courses.ts). Writes are
// re-validated here against the facts that are approved *now*, so a fact that went stale while the
// model was writing can never be cited by a saved course.

const ACTOR = "agent:generate_courses";
const mode = v.union(v.literal("live"), v.literal("offline"));
const patch = v.object({ op: v.union(v.literal("set"), v.literal("add"), v.literal("remove")), path: v.string(), value: v.optional(v.any()) });

/** Everything one slice needs: approved facts, brand voice and the space's existing courses. */
export const context = workerQuery({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const space = await ctx.db.get(spaceId);
    if (!space) return fail(404, "Space not found");
    const facts = await ctx.db
      .query("facts")
      .withIndex("by_space_status", (q) => q.eq("spaceId", spaceId).eq("status", "approved"))
      .take(2000);
    const stale = await ctx.db
      .query("facts")
      .withIndex("by_space_status", (q) => q.eq("spaceId", spaceId).eq("status", "stale"))
      .take(500);
    const brand = space.brandProfileId
      ? await ctx.db.get(space.brandProfileId)
      : await ctx.db.query("brand_profiles").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").first();
    const courses = await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).collect();
    return {
      company: space.name,
      voice: brand?.voice ?? "",
      facts: facts.map((f) => ({ id: f._id as string, category: f.category, text: f.text, confidence: f.confidence })),
      /** No longer approved (their source changed) — the step refresh must stop teaching these. */
      staleFacts: stale.map((f) => ({ id: f._id as string, category: f.category, text: f.text })),
      courses: courses.map((c) => ({
        id: c._id,
        packType: c.packType,
        status: c.status,
        version: c.version,
        spec: c.spec as CourseSpec,
        staleStepIds: c.staleStepIds ?? [],
      })),
    };
  },
});

/** Upsert one course by (space, packType). Scan runs keep an existing course; regenerate rebuilds it. */
export const upsert = workerMutation({
  args: {
    spaceId: v.id("spaces"),
    packType: v.string(),
    spec: v.any(),
    mode,
    jobId: v.id("jobs"),
    regenerate: v.boolean(),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, { spaceId, packType, spec: raw, mode, jobId, regenerate, requestedBy }) => {
    const pack = packFor(packType);
    if (!pack) return fail(422, `Unknown course pack "${packType}"`);
    const checked = await validateForSpace(ctx, spaceId, raw);
    if (!checked.ok) return fail(422, `Course spec is invalid: ${checked.errors.slice(0, 5).join("; ")}`);
    const spec = checked.spec;
    const fields = { title: spec.title, icon: spec.icon, building: spec.building, game: spec.game, spec, mode, needsRefresh: false, staleStepIds: [] };

    const existing = await ctx.db
      .query("courses")
      .withIndex("by_space_pack", (q) => q.eq("spaceId", spaceId).eq("packType", packType))
      .first();
    if (!existing) {
      const courseId = await ctx.db.insert("courses", { spaceId, packType, status: "draft", version: 1, ...fields });
      await syncCourseFacts(ctx, { _id: courseId, spaceId }, spec);
      await ctx.db.insert("audit_events", { spaceId, actor: ACTOR, kind: "course.generated", payload: { courseId, packType, version: 1, mode, jobId, facts: citedIds(spec).length } });
      return { courseId, version: 1, status: "created" as const };
    }
    if (!regenerate) return { courseId: existing._id, version: existing.version, status: "kept" as const };

    const version = existing.version + 1;
    const live = await republishIfLive(ctx, existing, spec, version, ACTOR);
    await ctx.db.patch(existing._id, { ...fields, version, ...(existing.status === "stale" ? { status: "draft" as const } : {}), ...live });
    await syncCourseFacts(ctx, existing, spec);
    await ctx.db.insert("audit_events", {
      spaceId,
      actor: requestedBy ?? ACTOR,
      kind: "course.regenerated",
      payload: { courseId: existing._id, packType, fromVersion: existing.version, toVersion: version, mode, jobId, clearedSteps: existing.staleStepIds ?? [] },
    });
    return { courseId: existing._id, version, status: "regenerated" as const, republished: "publishedVersion" in live };
  },
});

/** Step-level refresh: apply validated patches that rewrite (or drop) only the stale steps. */
export const applySteps = workerMutation({
  args: {
    courseId: v.id("courses"),
    baseVersion: v.number(),
    stepIds: v.array(v.string()),
    patches: v.array(patch),
    mode,
    jobId: v.id("jobs"),
    requestedBy: v.optional(v.string()),
  },
  handler: async (ctx, { courseId, baseVersion, stepIds, patches, mode, jobId, requestedBy }) => {
    const course = await ctx.db.get(courseId);
    if (!course) return fail(404, "Course not found");
    if (course.version !== baseVersion) return fail(409, `Course changed while its steps were being rewritten (v${baseVersion} → v${course.version})`);
    const r = await patchForSpace(ctx, course.spaceId, course.spec as CourseSpec, patches as CoursePatch[]);
    if (!r.ok) return fail(422, `Step refresh is invalid: ${r.errors.slice(0, 5).join("; ")}`);
    const version = course.version + 1;
    const staleStepIds = (course.staleStepIds ?? []).filter((id) => !stepIds.includes(id));
    const live = await republishIfLive(ctx, course, r.spec, version, ACTOR);
    await ctx.db.patch(courseId, {
      spec: r.spec,
      title: r.spec.title,
      version,
      mode,
      staleStepIds,
      needsRefresh: staleStepIds.length > 0,
      ...live,
    });
    await syncCourseFacts(ctx, course, r.spec);
    await ctx.db.insert("audit_events", {
      spaceId: course.spaceId,
      actor: requestedBy ?? ACTOR,
      kind: "course.steps_regenerated",
      payload: { courseId, course: course.title, stepIds, fromVersion: course.version, toVersion: version, mode, jobId, summary: r.summary ?? "" },
    });
    return { courseId, version, staleStepIds, republished: "publishedVersion" in live };
  },
});
