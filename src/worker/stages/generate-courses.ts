import { z } from "zod";
import { api } from "@convex/_generated/api";
import type { CourseTarget } from "@convex/courses";
import type { FunctionReturnType } from "convex/server";
import { applyCoursePatches, stepRefreshPatches } from "@/lib/flow/course-patch";
import { COURSE_PACKS, MAX_FACTS_PER_COURSE, MIN_FACTS_PER_COURSE, MIN_FACTS_PER_TOPIC, packFor, type CoursePack } from "@/lib/flow/course-packs";
import { CourseStep, courseSpecSchema, type CourseSpec } from "@/lib/flow/course-spec";
import { COURSE_STEPS_SYSTEM_PROMPT, COURSE_SYSTEM_PROMPT, COURSE_TOPIC_SYSTEM_PROMPT } from "@/lib/prompts";
import type { StageContext, StageDefinition } from "../types";
import { factsForCourse } from "./course-facts";
import { offlineCourse, offlineStepRefresh, type CourseFact } from "./course-offline";

// `generate_courses` (scan chain after seed_brain, manager-confirmed regeneration F36, and courses
// the manager names, F22). One slice works through course targets: in a scan every default pack (an
// existing course is kept — courses only regenerate on the manager's confirm); a manual job carries
// explicit targets: a whole pack, a topic (`topic-<slug>`), or just a course's stale step ids.
// Targets run in parallel (one LLM call each); progress is saved as each one lands so a resumed
// slice repeats nothing.

type Cursor = { targets?: CourseTarget[]; done?: string[] };
type Context = FunctionReturnType<typeof api.courseGen.context>;

/** Don't start another target when less than this is left in the slice. */
const TARGET_BUDGET_MS = 20_000;
/** Courses written at once: each is one independent LLM call. */
export const COURSE_CONCURRENCY = 4;

/**
 * Models vary in how they mark removals (`remove: [...]`, a step with `"remove": true`, or an id
 * string in `steps`) and sometimes echo untouched steps; keep only the requested ids.
 */
export function normaliseRefresh(raw: unknown, stepIds: string[]): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const r = raw as { steps?: unknown; remove?: unknown };
  const remove = new Set(Array.isArray(r.remove) ? r.remove.filter((x): x is string => typeof x === "string") : []);
  const steps: unknown[] = [];
  for (const s of Array.isArray(r.steps) ? r.steps : []) {
    if (typeof s === "string") remove.add(s);
    else if (s && typeof s === "object" && "remove" in s) {
      const { remove: flag, ...rest } = s as Record<string, unknown>;
      if (flag) remove.add(String(rest.id));
      else steps.push(rest);
    } else steps.push(s);
  }
  const wanted = (id: unknown) => typeof id === "string" && stepIds.includes(id);
  return { steps: steps.filter((s) => wanted((s as { id?: unknown })?.id)), remove: [...remove].filter(wanted) };
}

const label = (mode: "live" | "offline") => (mode === "offline" ? " (offline stand-in)" : "");

/** The honest "not enough in the brain" line for a topic (F22); never padded with other facts. */
export function tooFewTopicFacts(topic: string, n: number): string {
  // "Security" reads as "about security"; acronyms ("SOC 2") keep their case.
  const about = `about ${/^[A-Z][a-z]/.test(topic) ? topic.replace(/^./, (c) => c.toLowerCase()) : topic}`;
  const have = n === 0 ? `No facts ${about} in your brain yet.` : `Only ${n} fact${n === 1 ? "" : "s"} ${about} in your brain.`;
  return `${have} Connect a tool or upload a doc that covers it.`;
}

async function buildCourse(ctx: StageContext, data: Context, pack: CoursePack, target: CourseTarget, scan: boolean): Promise<string> {
  const t0 = Date.now();
  const facts = await factsForCourse(ctx, pack, data.facts, MAX_FACTS_PER_COURSE);
  const retrievalMs = Date.now() - t0;
  const min = pack.topic ? MIN_FACTS_PER_TOPIC : MIN_FACTS_PER_COURSE;
  if (facts.length < min) {
    const msg = pack.topic
      ? tooFewTopicFacts(pack.topic, facts.length)
      : `Skipped ${pack.title}: ${facts.length} approved ${pack.categories.join("/")} fact${facts.length === 1 ? "" : "s"} in the brain, needs ${MIN_FACTS_PER_COURSE}. Approve more facts, then regenerate.`;
    await ctx.event("warn", msg, { packType: pack.packType, facts: facts.length, skipped: true });
    return `${pack.title} skipped`;
  }
  const approved = new Set(facts.map((f) => f.id));
  const course = { title: pack.title, icon: pack.icon, building: pack.building, game: pack.game, desc: pack.desc };
  const user = JSON.stringify({
    company: data.company,
    voice: data.voice || "(no tone of voice extracted; plain, friendly, direct)",
    course: pack.topic ? { ...course, topic: pack.topic } : { ...course, outline: pack.lessons },
    facts: facts.map((f) => ({ id: f.id, category: f.category, text: f.text })),
  });
  const res = await ctx.llm.json({
    task: pack.topic ? "generate_topic_course" : "generate_course",
    system: pack.topic ? COURSE_TOPIC_SYSTEM_PROMPT : COURSE_SYSTEM_PROMPT,
    user,
    schema: courseSpecSchema(approved),
    offline: () => offlineCourse(pack, facts, data.facts),
  });
  const llmMs = Date.now() - t0 - retrievalMs;
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
    await ctx.event("info", `Kept ${pack.title} as it is (regenerate it from Courses to rebuild it)`, { packType: pack.packType });
    return `${pack.title} kept`;
  }
  const taught = new Set(spec.steps.flatMap((s) => s.teaches_fact_ids)).size;
  const verb = r.status === "created" ? "Drafted" : "Regenerated";
  const ms = Date.now() - t0;
  await ctx.event("info", `${verb} ${pack.title}: ${spec.steps.length} steps teaching ${taught} facts${label(res.mode)} · ${(ms / 1000).toFixed(1)} s`, {
    courseId: r.courseId,
    version: r.version,
    mode: res.mode,
    packType: pack.packType,
    facts: facts.length,
    ms,
    retrievalMs,
    llmMs,
  });
  return `${pack.title} ${r.status}`;
}

const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9$€£%.]+/g) ?? []);
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, Math.min(a.size, b.size));
}

/**
 * D-36: the approved facts most like the ones that stopped being true, i.e. what the company says
 * now ("$16 per user" went stale, "$18 per user" is its replacement). They lead the refresh's fact
 * list so a change is taught as the new truth, not just dropped.
 */
export function likelyReplacements(stale: { text: string }[], approved: CourseFact[], limit = 12): CourseFact[] {
  const gone = stale.map((f) => words(f.text));
  return approved
    .map((f) => ({ f, score: Math.max(0, ...gone.map((g) => overlap(words(f.text), g))) }))
    .filter((x) => x.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}

async function refreshSteps(ctx: StageContext, data: Context, pack: CoursePack, course: Context["courses"][number], target: CourseTarget): Promise<string> {
  const stepIds = (target.stepIds ?? []).filter((id) => course.spec.steps.some((s) => s.id === id));
  if (stepIds.length === 0) return buildCourse(ctx, data, pack, { packType: pack.packType, requestedBy: target.requestedBy }, false);
  const allApproved = new Set(data.facts.map((f) => f.id));
  const byId = new Map(data.facts.map((f) => [f.id, f]));
  const kinds = new Map(course.spec.steps.map((s) => [s.id, s.kind]));
  // What these steps taught that stopped being true, and what the company says now instead.
  const taughtHere = new Set(course.spec.steps.filter((st) => stepIds.includes(st.id)).flatMap((st) => st.teaches_fact_ids));
  const replacements = likelyReplacements(data.staleFacts.filter((f) => taughtHere.has(f.id)), data.facts);
  // A teaching step whose every fact is no longer approved, and nothing now true replaces them,
  // has nothing left to stand on: it must go. With a replacement it is rewritten instead (D-36).
  const staleById = new Map(data.staleFacts.map((f) => [f.id, f]));
  const orphaned = course.spec.steps
    .filter((s) => stepIds.includes(s.id) && s.teaches_fact_ids.length > 0 && s.teaches_fact_ids.every((id) => !allApproved.has(id)))
    .filter((s) => likelyReplacements(s.teaches_fact_ids.flatMap((id) => staleById.get(id) ?? []), data.facts).length === 0)
    .map((s) => s.id);

  const schema = z
    .preprocess((raw) => normaliseRefresh(raw, stepIds), z.object({ steps: z.array(CourseStep).max(24), remove: z.array(z.string()).max(24) }))
    .superRefine((out, zctx) => {
      if (out.steps.length + out.remove.length === 0) {
        zctx.addIssue({ code: "custom", message: `rewrite or remove these step ids: ${stepIds.join(", ")}` });
        return;
      }
      for (const s of out.steps) if (kinds.get(s.id) !== s.kind) zctx.addIssue({ code: "custom", message: `step "${s.id}" must keep kind ${kinds.get(s.id)}` });
      for (const id of orphaned) {
        if (!out.remove.includes(id)) zctx.addIssue({ code: "custom", message: `step "${id}" only taught facts that are no longer true; put it in "remove"` });
      }
      // D-36: a change is taught as the new truth: the rewrite cites what is now true instead.
      const nowTrue = new Set(replacements.map((f) => f.id));
      if (nowTrue.size && out.steps.length && !out.steps.some((st) => st.teaches_fact_ids.some((id) => nowTrue.has(id)))) {
        zctx.addIssue({ code: "custom", message: `teach what is now true: cite at least one of these fact ids in a rewritten step: ${[...nowTrue].slice(0, 6).join(", ")}` });
      }
      // Validating the patched course also proves no stale fact is still cited by an untouched target.
      const r = applyCoursePatches(course.spec, stepRefreshPatches(course.spec, out.steps, out.remove), allApproved);
      if (!r.ok) for (const message of r.errors) zctx.addIssue({ code: "custom", message });
    });
  const res = await ctx.llm.json({
    task: "regenerate_course_steps",
    system: COURSE_STEPS_SYSTEM_PROMPT,
    user: JSON.stringify({
      company: data.company,
      voice: data.voice || "(no tone of voice extracted; plain, friendly, direct)",
      course: course.spec,
      rewrite_step_ids: stepIds,
      must_remove: orphaned,
      facts: [...new Map([...replacements, ...(await factsForCourse(ctx, pack, data.facts, MAX_FACTS_PER_COURSE))].map((f) => [f.id, f])).values()].map((f) => ({ id: f.id, category: f.category, text: f.text })),
      no_longer_true: data.staleFacts.map((f) => f.text),
      now_true_instead: replacements.map((f) => f.text),
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
  const removed = res.value.remove.length;
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
    let saved = Promise.resolve();
    let deferred = false;
    const one = async (target: CourseTarget) => {
      const course = data.courses.find((c) => c.packType === target.packType);
      // A topic course keeps its title as its topic when it is rebuilt.
      const pack = packFor(target.packType, target.topic ?? course?.spec?.title);
      if (!pack) {
        await ctx.event("warn", `No course pack "${target.packType}", skipped`);
      } else if (scan && course) {
        await ctx.event("info", `Kept ${pack.title} as it is (regenerate it from Courses to rebuild it)`, { packType: pack.packType });
        lines.push(`${pack.title} kept`);
      } else if (target.stepIds?.length && course) {
        lines.push(await refreshSteps(ctx, data, pack, course, target));
      } else {
        lines.push(await buildCourse(ctx, data, pack, target, scan));
      }
      done.add(target.packType);
      const snapshot = [...done];
      saved = saved.then(() => ctx.progress(snapshot.length / targets.length, { ...cursor, done: snapshot }));
      await saved;
    };
    const queue = targets.filter((t) => !done.has(t.packType));
    const errors: unknown[] = [];
    const lane = async () => {
      for (let target = queue.shift(); target; target = queue.shift()) {
        if (ctx.lost()) return;
        if (done.size > 0 && ctx.remainingMs() < TARGET_BUDGET_MS) {
          deferred = true;
          return;
        }
        // One failed course doesn't throw away the others: they land, then the slice retries it.
        await one(target).catch((err) => errors.push(err));
      }
    };
    await Promise.all(Array.from({ length: Math.min(COURSE_CONCURRENCY, queue.length) }, lane));
    await saved;
    if (errors.length) throw errors[0];
    if (deferred || queue.length) return { done: false, cursor: { ...cursor, done: [...done] }, progress: done.size / targets.length };
    return { done: true, summary: lines.join(", ") || "no courses to build" };
  },
};

