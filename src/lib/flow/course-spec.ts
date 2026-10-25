import { z } from "zod";

// CourseSpec: the JSON contract for one onboarding course (BUILD-CONTRACT "Course contract").
// The model proposes it from approved brain facts; Zod covers shape and `courseSpecErrors` adds the
// cross-field rules (welcome first, done last, every teaching step cites approved facts, option
// shapes per step kind). Imported by the worker stage and by Convex (keep it dependency-free
// apart from zod, relative imports only).

export const COURSE_STEP_KINDS = ["welcome", "fields", "lesson", "quiz", "scenario", "checklist", "done"] as const;
export type CourseStepKind = (typeof COURSE_STEP_KINDS)[number];

export const COURSE_GAMES = ["quiz", "inbox", "road", "scenario"] as const;
export type CourseGame = (typeof COURSE_GAMES)[number];

/** Step kinds that teach brain content and therefore must cite ≥1 approved fact. */
export const TEACHING_KINDS: readonly CourseStepKind[] = ["lesson", "quiz", "scenario"];

export const CourseOption = z
  .object({
    label: z.string().trim().min(1).max(200),
    /** quiz/scenario only: the right answer (quiz) or the best response (scenario). */
    correct: z.boolean().optional(),
    /** quiz/scenario only: one line on why, shown after answering. */
    why: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type CourseOption = z.infer<typeof CourseOption>;

export const STEP_ID_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Models often send `options: []` / `body: ""` for steps without them — treat those as absent. */
function dropEmpty(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const step = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(step.options) && step.options.length === 0) delete step.options;
  if (step.options === null) delete step.options;
  if (step.body === "" || step.body === null) delete step.body;
  return step;
}

const CourseStepShape = z
  .object({
    /** Stable step id (slug), unique in the course: drift marks steps stale by id (F36). */
    id: z.string().regex(STEP_ID_RE, "expected a short lowercase slug like 'deploy-quiz'"),
    kind: z.enum(COURSE_STEP_KINDS),
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(1500).optional(),
    options: z.array(CourseOption).max(8).optional(),
    teaches_fact_ids: z.array(z.string().min(1).max(64)).max(16),
  })
  .strict();
export const CourseStep = z.preprocess(dropEmpty, CourseStepShape);
export type CourseStep = z.infer<typeof CourseStepShape>;

export const CourseSpec = z
  .object({
    title: z.string().trim().min(1).max(80),
    /** Icon name from the mockup's icon set (state.js ICONS), e.g. "landmark". */
    icon: z.string().regex(/^[a-z][a-z0-9-]{0,30}$/, "expected an icon name like 'landmark'"),
    building: z.string().trim().min(1).max(60),
    game: z.enum(COURSE_GAMES),
    /** One-line course description (course.html subtitle). */
    desc: z.string().trim().min(1).max(200).optional(),
    steps: z.array(CourseStep).min(3).max(24),
  })
  .strict();
export type CourseSpec = z.infer<typeof CourseSpec>;

/** Option rules per step kind: [min, max, how many must be `correct`] — null = no options allowed. */
const OPTION_RULES: Record<CourseStepKind, { min: number; max: number; correct: "one" | "none" } | null> = {
  welcome: null,
  lesson: null,
  done: null,
  fields: { min: 1, max: 6, correct: "none" },
  checklist: { min: 2, max: 8, correct: "none" },
  quiz: { min: 2, max: 5, correct: "one" },
  scenario: { min: 2, max: 5, correct: "one" },
};

/**
 * Cross-field rules Zod cannot express. `approvedFactIds` is the set of the space's facts with
 * status `approved`; any cited id outside it (draft, stale, rejected, other space, invented) fails.
 */
export function courseSpecErrors(spec: CourseSpec, approvedFactIds: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const { steps } = spec;
  if (steps[0]?.kind !== "welcome") errors.push("steps.0.kind: the first step must be a welcome step");
  if (steps[steps.length - 1]?.kind !== "done") errors.push(`steps.${steps.length - 1}.kind: the last step must be a done step`);
  const seen = new Set<string>();
  steps.forEach((step, i) => {
    const at = `steps.${i}`;
    if (seen.has(step.id)) errors.push(`${at}.id: duplicate step id "${step.id}"`);
    seen.add(step.id);
    if (step.kind === "welcome" && i !== 0) errors.push(`${at}.kind: only the first step may be a welcome step`);
    if (step.kind === "done" && i !== steps.length - 1) errors.push(`${at}.kind: only the last step may be a done step`);
    if (TEACHING_KINDS.includes(step.kind) && step.teaches_fact_ids.length === 0) {
      errors.push(`${at}.teaches_fact_ids: a ${step.kind} step must cite at least one approved fact`);
    }
    if (new Set(step.teaches_fact_ids).size !== step.teaches_fact_ids.length) errors.push(`${at}.teaches_fact_ids: duplicate fact id`);
    for (const id of step.teaches_fact_ids) {
      if (!approvedFactIds.has(id)) errors.push(`${at}.teaches_fact_ids: "${id}" is not an approved fact of this space`);
    }
    const rule = OPTION_RULES[step.kind];
    const options = step.options ?? [];
    if (!rule) {
      if (step.options) errors.push(`${at}.options: a ${step.kind} step has no options`);
      return;
    }
    if (options.length < rule.min || options.length > rule.max) {
      errors.push(`${at}.options: a ${step.kind} step needs ${rule.min}–${rule.max} options, got ${options.length}`);
    }
    const correct = options.filter((o) => o.correct === true).length;
    if (rule.correct === "one" && correct !== 1) errors.push(`${at}.options: exactly one option must be correct, got ${correct}`);
    if (rule.correct === "none" && options.some((o) => o.correct !== undefined || o.why !== undefined)) {
      errors.push(`${at}.options: ${step.kind} options take a label only`);
    }
    const labels = options.map((o) => o.label.toLowerCase());
    if (new Set(labels).size !== labels.length) errors.push(`${at}.options: option labels must be distinct`);
  });
  if (!steps.some((s) => TEACHING_KINDS.includes(s.kind))) errors.push("steps: a course needs at least one lesson, quiz or scenario step");
  return errors;
}

/** Zod schema with the cross-field rules attached — what `ctx.llm.json` validates model output with. */
export function courseSpecSchema(approvedFactIds: ReadonlySet<string>) {
  return CourseSpec.superRefine((spec, ctx) => {
    for (const message of courseSpecErrors(spec, approvedFactIds)) ctx.addIssue({ code: "custom", message });
  });
}

export type CourseValidation = { ok: true; spec: CourseSpec } | { ok: false; errors: string[] };

export function validateCourseSpec(json: unknown, approvedFactIds: ReadonlySet<string>): CourseValidation {
  const parsed = CourseSpec.safeParse(json);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`) };
  }
  const errors = courseSpecErrors(parsed.data, approvedFactIds);
  return errors.length ? { ok: false, errors } : { ok: true, spec: parsed.data };
}

/** Every (fact, step) pair the course teaches — the `course_facts` join rows. */
export function taughtFacts(spec: CourseSpec): { factId: string; stepId: string }[] {
  const seen = new Set<string>();
  const out: { factId: string; stepId: string }[] = [];
  for (const step of spec.steps) {
    for (const factId of step.teaches_fact_ids) {
      const key = `${factId}|${step.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ factId, stepId: step.id });
    }
  }
  return out;
}
