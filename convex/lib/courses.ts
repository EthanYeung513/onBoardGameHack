import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { applyCoursePatches, type CoursePatch } from "../../src/lib/flow/course-patch";
import { CourseSpec as CourseSpecShape, taughtFacts, validateCourseSpec, type CourseSpec, type CourseValidation } from "../../src/lib/flow/course-spec";

// Shared by the manager functions (convex/courses.ts) and the worker writes (convex/courseGen.ts).

/** Which of `ids` are approved facts of this space — the only facts a course may cite. */
export async function approvedFactSet(ctx: QueryCtx, spaceId: Id<"spaces">, ids: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of new Set(ids)) {
    const factId = ctx.db.normalizeId("facts", id);
    if (!factId) continue;
    const fact = await ctx.db.get(factId);
    if (fact && fact.spaceId === spaceId && fact.status === "approved") out.add(id);
  }
  return out;
}

/** Shape check, then the cross-field rules against the facts approved in this space right now. */
export async function validateForSpace(ctx: QueryCtx, spaceId: Id<"spaces">, raw: unknown): Promise<CourseValidation> {
  const shape = CourseSpecShape.safeParse(raw);
  const ids = shape.success ? citedIds(shape.data) : [];
  return validateCourseSpec(raw, await approvedFactSet(ctx, spaceId, ids));
}

/** Any fact id passes — patches are applied first, then the result is validated against the space. */
const ANY_FACT: ReadonlySet<string> = { has: () => true } as unknown as ReadonlySet<string>;

/** Apply `{op,path,value}` patches and validate the result under the generation rules (F36, editor). */
export async function patchForSpace(ctx: QueryCtx, spaceId: Id<"spaces">, spec: CourseSpec, patches: CoursePatch[]): Promise<CourseValidation & { summary?: string }> {
  const draft = applyCoursePatches(spec, patches, ANY_FACT);
  if (!draft.ok) return draft;
  const checked = await validateForSpace(ctx, spaceId, draft.spec);
  return checked.ok ? { ...checked, summary: draft.summary } : checked;
}

export const citedIds = (spec: CourseSpec) => spec.steps.flatMap((s) => s.teaches_fact_ids);

/** Replace the course's `course_facts` rows with what the spec teaches now (fact + step). */
export async function syncCourseFacts(ctx: MutationCtx, course: Pick<Doc<"courses">, "_id" | "spaceId">, spec: CourseSpec) {
  for (const row of await ctx.db.query("course_facts").withIndex("by_course", (q) => q.eq("courseId", course._id)).collect()) {
    await ctx.db.delete(row._id);
  }
  for (const { factId, stepId } of taughtFacts(spec)) {
    const id = ctx.db.normalizeId("facts", factId);
    if (id) await ctx.db.insert("course_facts", { spaceId: course.spaceId, courseId: course._id, factId: id, stepId });
  }
}

/**
 * A regenerated course that is live gets its published content rebuilt (F36, BUILD-CONTRACT drift
 * contract): the game handoff reads `publishedSpec`/`publishedVersion`. Returns the patch fields.
 */
export async function republishIfLive(ctx: MutationCtx, course: Doc<"courses">, spec: CourseSpec, version: number, actor: string) {
  if (course.status !== "published") return {};
  await ctx.db.insert("audit_events", {
    spaceId: course.spaceId,
    actor,
    kind: "course.republished",
    payload: { courseId: course._id, course: spec.title, fromVersion: course.publishedVersion ?? course.version, toVersion: version },
  });
  return { publishedSpec: spec, publishedVersion: version };
}
