import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Hire progress, derived from `attempts` (the real version of the mockup's `h.games[courseId]`).
// A course counts as done for a hire once they reached its `done` step, or attempted every scored
// step of its CourseSpec. Scores are 0–100 (0–1 values are scaled), averaged per course.

/** Per-space read caps: every aggregate stays on a `by_space` index and never scans past these. */
export const CAP = { hires: 500, courses: 200, attempts: 10_000, facts: 10_000, connectors: 50 } as const;

const UNSCORED = new Set(["welcome", "done"]);

export function scoredStepCount(spec: unknown): number {
  const steps = (spec as { steps?: { kind?: string }[] } | null)?.steps;
  return Array.isArray(steps) ? steps.filter((s) => !UNSCORED.has(String(s?.kind))).length : 0;
}

export type CourseProgress = { done: boolean; score: number; at: number };
export type HireProgress = {
  perCourse: Map<Id<"courses">, CourseProgress>;
  coursesDone: number;
  progress: number;
  lastActivity: number | null;
};

const pct = (s: number) => (s <= 1 ? s * 100 : s);

export function progressFor(courses: Doc<"courses">[], attempts: Doc<"attempts">[]): HireProgress {
  const perCourse = new Map<Id<"courses">, CourseProgress>();
  let lastActivity: number | null = null;
  for (const course of courses) {
    const mine = attempts.filter((a) => a.courseId === course._id);
    if (!mine.length) continue;
    const steps = new Set(mine.map((a) => a.stepId));
    const needed = scoredStepCount(course.spec);
    const done = steps.has("done") || (needed > 0 && [...steps].filter((s) => !UNSCORED.has(s)).length >= needed);
    const score = Math.round(mine.reduce((sum, a) => sum + pct(a.score), 0) / mine.length);
    const at = Math.max(...mine.map((a) => a._creationTime));
    lastActivity = Math.max(lastActivity ?? 0, at);
    perCourse.set(course._id, { done, score, at });
  }
  const coursesDone = [...perCourse.values()].filter((p) => p.done).length;
  return { perCourse, coursesDone, progress: courses.length ? Math.round((coursesDone / courses.length) * 100) : 0, lastActivity };
}

/** Everything the dashboard aggregates read, each on its `by_space` index. */
export async function loadSpaceActivity(ctx: QueryCtx, spaceId: Id<"spaces">) {
  const [hires, allCourses, attempts] = await Promise.all([
    ctx.db.query("hires").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.hires),
    ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.courses),
    ctx.db.query("attempts").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.attempts),
  ]);
  const courses = allCourses.filter((c) => c.status !== "archived");
  const byHire = new Map<Id<"hires">, Doc<"attempts">[]>();
  for (const a of attempts) byHire.set(a.hireId, [...(byHire.get(a.hireId) ?? []), a]);
  const rows = hires
    .sort((a, b) => a._creationTime - b._creationTime)
    .map((hire) => ({ hire, ...progressFor(courses, byHire.get(hire._id) ?? []) }));
  return { hires: rows, courses };
}

export const displayName = (h: Pick<Doc<"hires">, "name" | "email">) =>
  h.name?.trim() || h.email.split("@")[0].replace(/[^a-z]/gi, " ").trim() || "New hire";

export async function approvedFacts(ctx: QueryCtx, spaceId: Id<"spaces">) {
  return await ctx.db
    .query("facts")
    .withIndex("by_space_status", (q) => q.eq("spaceId", spaceId).eq("status", "approved"))
    .take(CAP.facts);
}
