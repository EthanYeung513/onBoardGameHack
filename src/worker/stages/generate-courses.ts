import { z } from "zod";
import { api } from "@convex/_generated/api";
import type { CourseTarget } from "@convex/courses";
import type { FunctionReturnType } from "convex/server";
import { applyCoursePatches, stepRefreshPatches } from "@/lib/flow/course-patch";
import { COURSE_PACKS, MAX_FACTS_PER_COURSE, MIN_FACTS_PER_COURSE, packFor, type CoursePack } from "@/lib/flow/course-packs";
import { CourseStep, courseSpecSchema, type CourseSpec } from "@/lib/flow/course-spec";
import { COURSE_STEPS_SYSTEM_PROMPT, COURSE_SYSTEM_PROMPT } from "@/lib/prompts";
import type { StageContext, StageDefinition } from "../types";
import { offlineCourse, offlineStepRefresh, type CourseFact } from "./course-offline";

// `generate_courses` (scan chain after seed_brain, and manager-confirmed regeneration, F36).
// One slice works through course targets: in a scan every default pack (an existing course is
// kept — courses only regenerate on the manager's confirm); a manual job carries explicit targets,
// either a whole pack or just its stale step ids. Progress is saved after each target so a resumed
// slice repeats nothing.

type Cursor = { targets?: CourseTarget[]; done?: string[] };
type Context = FunctionReturnType<typeof api.courseGen.context>;

/** Stop starting new targets when less than this is left in the slice. */
const TARGET_BUDGET_MS = 20_000;

export function factsForPack(pack: CoursePack, facts: CourseFact[]): CourseFact[] {
  const rank = (f: CourseFact) => pack.categories.indexOf(f.category as CoursePack["categories"][number]);
  return facts
    .filter((f) => rank(f) >= 0)
    .sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, MAX_FACTS_PER_COURSE);
}

const label = (mode: "live" | "offline") => (mode === "offline" ? " (offline stand-in)" : "");

async function buildCourse(ctx: StageContext, data: Context, pack: CoursePack, target: CourseTarget, scan: boolean): Promise<string> {
  const facts = factsForPack(pack, data.facts);
  if (facts.length < MIN_FACTS_PER_COURSE) {
    const msg = `Skipped ${pack.title}: ${facts.length} approved ${pack.categories.join("/")} fact${facts.length === 1 ? "" : "s"} in the brain, needs ${MIN_FACTS_PER_COURSE}. Approve more facts, then regenerate.`;
    await ctx.event("warn", msg, { packType: pack.packType, facts: facts.length });
    return `${pack.title} skipped`;
  }
  const approved = new Set(facts.map((f) => f.id));
  const user = JSON.stringify({
    company: data.company,
    voice: data.voice || "(no tone of voice extracted — plain, friendly, direct)",
    course: { title: pack.title, icon: pack.icon, building: pack.building, game: pack.game, desc: pack.desc, outline: pack.lessons },
    facts: facts.map((f) => ({ id: f.id, category: f.category, text: f.text })),
  });
  const res = await ctx.llm.json({
    task: "generate_course",
    system: COURSE_SYSTEM_PROMPT,
    user,
    schema: courseSpecSchema(approved),
    offline: () => offlineCourse(pack, facts, data.facts),
  });
  // The pack's identity is the mockup's, whatever the model echoed back.
  const spec: CourseSpec = { ...res.value, title: pack.title, icon: pack.icon, building: pack.building, game: pack.game, desc: pack.desc };
  const r = await ctx.convex.mutation(api.courseGen.upsert, {
    spaceId: ctx.space._id,
    packType: pack.packType,
    spec,
    mode: res.mode,
    jobId: ctx.job._id,
    regenerate: !scan,
    requestedBy: target.requestedBy,
  });
  if (r.status === "kept") {
    await ctx.event("info", `Kept ${pack.title} as it is — regenerate it from Courses to rebuild it`, { packType: pack.packType });
    return `${pack.title} kept`;
  }
  const taught = new Set(spec.steps.flatMap((s) => s.teaches_fact_ids)).size;
  const verb = r.status === "created" ? "Drafted" : "Regenerated";
  await ctx.event("info", `${verb} ${pack.title}: ${spec.steps.length} steps teaching ${taught} facts${label(res.mode)}`, { courseId: r.courseId, version: r.version, mode: res.mode });
  return `${pack.title} ${r.status}`;
}

async function refreshSteps(ctx: StageContext, data: Context, pack: CoursePack, course: Context["courses"][number], target: CourseTarget): Promise<string> {
  const stepIds = (target.stepIds ?? []).filter((id) => course.spec.steps.some((s) => s.id === id));
  if (stepIds.length === 0) return buildCourse(ctx, data, pack, { packType: pack.packType, requestedBy: target.requestedBy }, false);
  const allApproved = new Set(data.facts.map((f) => f.id));
  const byId = new Map(data.facts.map((f) => [f.id, f]));
  const kinds = new Map(course.spec.steps.map((s) => [s.id, s.kind]));
  const schema = z
    .object({ steps: z.array(CourseStep).max(24), remove: z.array(z.string()).max(24).optional() })
    .superRefine((out, zctx) => {
      const got = [...out.steps.map((s) => s.id), ...(out.remove ?? [])];
      if (got.length !== stepIds.length || !stepIds.every((id) => got.includes(id))) {
        zctx.addIssue({ code: "custom", message: `rewrite or remove exactly these step ids: ${stepIds.join(", ")}` });
        return;
      }
      for (const s of out.steps) if (kinds.get(s.id) !== s.kind) zctx.addIssue({ code: "custom", message: `step "${s.id}" must keep kind ${kinds.get(s.id)}` });
      const r = applyCoursePatches(course.spec, stepRefreshPatches(course.spec, out.steps, out.remove), allApproved);
      if (!r.ok) for (const message of r.errors) zctx.addIssue({ code: "custom", message });
    });
  const res = await ctx.llm.json({
    task: "regenerate_course_steps",
    system: COURSE_STEPS_SYSTEM_PROMPT,
    user: JSON.stringify({
      company: data.company,
      voice: data.voice || "(no tone of voice extracted — plain, friendly, direct)",
      course: course.spec,
      rewrite_step_ids: stepIds,
      facts: factsForPack(pack, data.facts).map((f) => ({ id: f.id, category: f.category, text: f.text })),
    }),
    schema,
    offline: () => offlineStepRefresh(course.spec, stepIds, byId),
  });
  const patches = stepRefreshPatches(course.spec, res.value.steps, res.value.remove);
  const check = applyCoursePatches(course.spec, patches, allApproved);
  if (!check.ok) {
    // Offline refresh can leave a course with nothing to teach — rebuild it from the brain instead.
    await ctx.event("warn", `Couldn't refresh ${pack.title} step by step (${check.errors[0]}); rebuilding the course`, { courseId: course.id });
    return buildCourse(ctx, data, pack, { packType: pack.packType, requestedBy: target.requestedBy }, false);
  }
  const r = await ctx.convex.mutation(api.courseGen.applySteps, {
    courseId: course.id,
    baseVersion: course.version,
    stepIds,
    patches,
    mode: res.mode,
    jobId: ctx.job._id,
    requestedBy: target.requestedBy,
  });
  const removed = res.value.remove?.length ?? 0;
  await ctx.event(
    "info",
    `Refreshed ${res.value.steps.length} step${res.value.steps.length === 1 ? "" : "s"} of ${pack.title}${removed ? `, removed ${removed} with no approved facts left` : ""}${label(res.mode)}`,
    { courseId: course.id, version: r.version, stepIds, mode: res.mode },
  );
  return `${pack.title} steps refreshed`;
}

export const generateCoursesStage: StageDefinition = {
  name: "generate_courses",
  async run(ctx) {
    const cursor = (ctx.job.cursor ?? {}) as Cursor;
    const scan = !cursor.targets;
    const targets: CourseTarget[] = cursor.targets ?? COURSE_PACKS.map((p) => ({ packType: p.packType }));
    const done = new Set(cursor.done ?? []);
    const data = await ctx.convex.query(api.courseGen.context, { spaceId: ctx.space._id });
    const lines: string[] = [];
    for (const target of targets) {
      if (done.has(target.packType)) continue;
      if (done.size > 0 && ctx.remainingMs() < TARGET_BUDGET_MS) {
        return { done: false, cursor: { ...cursor, done: [...done] }, progress: done.size / targets.length };
      }
      if (ctx.lost()) break;
      const pack = packFor(target.packType);
      const course = data.courses.find((c) => c.packType === target.packType);
      if (!pack) {
        await ctx.event("warn", `No course pack "${target.packType}" — skipped`);
      } else if (scan && course) {
        await ctx.event("info", `Kept ${pack.title} as it is — regenerate it from Courses to rebuild it`, { packType: pack.packType });
        lines.push(`${pack.title} kept`);
      } else if (target.stepIds?.length && course) {
        lines.push(await refreshSteps(ctx, data, pack, course, target));
      } else {
        lines.push(await buildCourse(ctx, data, pack, target, scan));
      }
      done.add(target.packType);
      await ctx.progress(done.size / targets.length, { ...cursor, done: [...done] });
    }
    return { done: true, summary: lines.join(", ") || "no courses to build" };
  },
};

