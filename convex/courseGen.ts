import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import type { CoursePatch } from "../src/lib/flow/course-patch";
import { packFor } from "../src/lib/flow/course-packs";
import type { CourseSpec } from "../src/lib/flow/course-spec";
import { citedIds, DRIFT_ACTOR, patchForSpace, republishIfLive, syncCourseFacts, validateForSpace } from "./lib/courses";
import { fail } from "./lib/errors";
import { EMBEDDING_DIMS } from "./schema";
import { workerAction, workerMutation, workerQuery } from "./lib/worker";

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
    const pack = packFor(packType, (raw as { title?: string } | null)?.title);
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
    // D-36: a rebuild caused by a detected company change is a draft for the manager: every step is
    // "New" and nothing reaches hires until "Update courses".
    const detected = requestedBy === DRIFT_ACTOR;
    const live = detected ? {} : await republishIfLive(ctx, existing, spec, version, ACTOR);
    const newStepIds = detected ? spec.steps.map((st) => st.id) : (existing.newStepIds ?? []).filter((id) => spec.steps.some((st) => st.id === id));
    await ctx.db.patch(existing._id, { ...fields, version, newStepIds, ...(existing.status === "stale" ? { status: "draft" as const } : {}), ...live });
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
    // D-36: steps rewritten for a detected company change get a "New" badge and wait for the
    // manager's "Update courses"; a manager's own refresh republishes as before.
    const detected = requestedBy === DRIFT_ACTOR;
    const live = detected ? {} : await republishIfLive(ctx, course, r.spec, version, ACTOR);
    const kept = new Set(r.spec.steps.map((st) => st.id));
    const newStepIds = [...new Set([...(course.newStepIds ?? []), ...(detected ? stepIds : [])])].filter((id) => kept.has(id));
    await ctx.db.patch(courseId, {
      spec: r.spec,
      title: r.spec.title,
      version,
      mode,
      staleStepIds,
      newStepIds,
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

/** Approved facts matching `q` in full text, and the approved facts citing each chunk (in order). */
export const topicCandidates = internalQuery({
  args: { spaceId: v.id("spaces"), q: v.string(), chunkIds: v.array(v.id("doc_chunks")) },
  handler: async (ctx, { spaceId, q, chunkIds }) => {
    const terms = q.trim().split(/\s+/).slice(0, 16).join(" ");
    const lexical = terms
      ? await ctx.db
          .query("facts")
          .withSearchIndex("search_text", (s) => s.search("text", terms).eq("spaceId", spaceId).eq("status", "approved"))
          .take(40)
      : [];
    const byChunk: { chunkId: Id<"doc_chunks">; factIds: string[] }[] = [];
    for (const chunkId of chunkIds) {
      const cites = await ctx.db.query("fact_citations").withIndex("by_chunk", (x) => x.eq("chunkId", chunkId)).take(25);
      const ids: string[] = [];
      for (const c of cites) {
        const f = await ctx.db.get(c.factId);
        if (f && f.spaceId === spaceId && f.status === "approved") ids.push(f._id);
      }
      byChunk.push({ chunkId, factIds: ids });
    }
    return { lexical: lexical.map((f) => f._id as string), byChunk };
  },
});

/**
 * F22 topic courses: candidate facts about a topic, the hybrid way brain search finds them (F17):
 * full text over facts plus vector search over the chunks they cite (vector search is action-only).
 * The worker re-ranks the candidates by embedding similarity to the topic.
 */
export const topicFacts = workerAction({
  args: { spaceId: v.id("spaces"), q: v.string(), vector: v.optional(v.array(v.float64())) },
  handler: async (ctx, { spaceId, q, vector }): Promise<{ lexical: string[]; semantic: { factId: string; score: number }[] }> => {
    const hits = vector?.length === EMBEDDING_DIMS ? await ctx.vectorSearch("doc_chunks", "by_embedding", { vector, limit: 24, filter: (f) => f.eq("spaceId", spaceId) }) : [];
    const r: { lexical: string[]; byChunk: { chunkId: Id<"doc_chunks">; factIds: string[] }[] } = await ctx.runQuery(internal.courseGen.topicCandidates, {
      spaceId,
      q: q.slice(0, 200),
      chunkIds: hits.map((h) => h._id),
    });
    const score = new Map(hits.map((h) => [h._id as string, h._score]));
    const best = new Map<string, number>();
    for (const c of r.byChunk) for (const id of c.factIds) best.set(id, Math.max(best.get(id) ?? 0, score.get(c.chunkId) ?? 0));
    return { lexical: r.lexical, semantic: [...best.entries()].map(([factId, s]) => ({ factId, score: s })).sort((a, b) => b.score - a.score) };
  },
});
