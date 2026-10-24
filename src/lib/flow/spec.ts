import { z } from "zod";
import { BASE_POINTS } from "./scoring";

// FlowSpec: the JSON contract the model emits for one gamified onboarding flow.
// Zod covers shape; validateFlowSpec adds the cross-field rules Zod cannot express.

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const Slug = z.string().regex(SLUG_RE, "expected a short lowercase slug like 'pick-goal'");
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");
const Emoji = z.string().min(1).max(16);

export const STEP_TYPES = [
  "welcome",
  "single_choice",
  "multiple_choice",
  "text_input",
  "email_signup",
  "feature_tour",
  "checklist",
  "quiz_question",
  "reward",
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export const Transition = z.enum(["slide", "fade", "scale", "stagger", "morph"]);
export type Transition = z.infer<typeof Transition>;

export const ConditionOp = z.enum(["equals", "includes", "not_equals", "answered"]);

export const Condition = z
  .object({
    stepId: Slug,
    op: ConditionOp,
    value: z.string().min(1).max(200).optional(),
  })
  .strict();
export type Condition = z.infer<typeof Condition>;

export const ShowIf = z
  .object({
    all: z.array(Condition).min(1).max(6).optional(),
    any: z.array(Condition).min(1).max(6).optional(),
  })
  .strict();
export type ShowIf = z.infer<typeof ShowIf>;

export const Option = z
  .object({
    id: Slug,
    label: z.string().min(1).max(80),
    emoji: Emoji.optional(),
  })
  .strict();
export type Option = z.infer<typeof Option>;

const base = {
  id: Slug,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(600).optional(),
  transition: Transition,
  points: z.number().int().min(0).max(500).optional(),
  /** Lets the user skip this step. email_signup is always skippable. */
  optional: z.boolean().optional(),
  showIf: ShowIf.optional(),
};

export const WelcomeStep = z
  .object({ ...base, type: z.literal("welcome"), emoji: Emoji.optional(), ctaLabel: z.string().min(1).max(40).optional() })
  .strict();

export const SingleChoiceStep = z
  .object({ ...base, type: z.literal("single_choice"), options: z.array(Option).min(2).max(8) })
  .strict();

export const MultipleChoiceStep = z
  .object({
    ...base,
    type: z.literal("multiple_choice"),
    options: z.array(Option).min(2).max(10),
    minSelect: z.number().int().min(1).max(10).optional(),
    maxSelect: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export const TextInputStep = z
  .object({
    ...base,
    type: z.literal("text_input"),
    inputLabel: z.string().min(1).max(80),
    placeholder: z.string().max(120).optional(),
    multiline: z.boolean().optional(),
    maxLength: z.number().int().min(1).max(2000).optional(),
  })
  .strict();

export const EmailSignupStep = z
  .object({
    ...base,
    type: z.literal("email_signup"),
    inputLabel: z.string().min(1).max(80).optional(),
    placeholder: z.string().max(120).optional(),
    consentText: z.string().max(300).optional(),
    ctaLabel: z.string().min(1).max(40).optional(),
  })
  .strict();

export const TourCard = z
  .object({
    title: z.string().min(1).max(80),
    body: z.string().min(1).max(400),
    emoji: Emoji.optional(),
    imageUrl: z.string().url().optional(),
  })
  .strict();
export type TourCard = z.infer<typeof TourCard>;

export const FeatureTourStep = z
  .object({ ...base, type: z.literal("feature_tour"), cards: z.array(TourCard).min(1).max(6) })
  .strict();

export const ChecklistItem = z
  .object({ id: Slug, label: z.string().min(1).max(100), hint: z.string().max(200).optional() })
  .strict();

export const ChecklistStep = z
  .object({
    ...base,
    type: z.literal("checklist"),
    items: z.array(ChecklistItem).min(2).max(8),
    /** When true every item must be ticked before continuing; otherwise one is enough. */
    requireAll: z.boolean().optional(),
  })
  .strict();

export const QuizQuestionStep = z
  .object({
    ...base,
    type: z.literal("quiz_question"),
    options: z.array(Option).min(2).max(6),
    correctOptionIds: z.array(Slug).min(1).max(6),
    explanation: z.string().min(1).max(400),
  })
  .strict();

export const RewardStep = z
  .object({ ...base, type: z.literal("reward"), emoji: Emoji.optional(), ctaLabel: z.string().min(1).max(40).optional() })
  .strict();

export const Step = z.discriminatedUnion("type", [
  WelcomeStep,
  SingleChoiceStep,
  MultipleChoiceStep,
  TextInputStep,
  EmailSignupStep,
  FeatureTourStep,
  ChecklistStep,
  QuizQuestionStep,
  RewardStep,
]);
export type Step = z.infer<typeof Step>;
export type StepOf<T extends StepType> = Extract<Step, { type: T }>;

export const BadgeRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("steps_completed"), count: z.number().int().min(1).max(12) }).strict(),
  z.object({ kind: z.literal("step_completed"), stepId: Slug }).strict(),
  z.object({ kind: z.literal("points_at_least"), points: z.number().int().min(1).max(10000) }).strict(),
  z.object({ kind: z.literal("quiz_correct"), count: z.number().int().min(1).max(12) }).strict(),
]);
export type BadgeRule = z.infer<typeof BadgeRule>;

export const Badge = z
  .object({ id: Slug, label: z.string().min(1).max(40), emoji: Emoji, rule: BadgeRule })
  .strict();
export type Badge = z.infer<typeof Badge>;

export const GamificationStyle = z.enum(["quest_path", "checklist_streak", "quiz_tour"]);
export type GamificationStyle = z.infer<typeof GamificationStyle>;

export const Gamification = z
  .object({
    style: GamificationStyle,
    mechanics: z
      .object({
        points: z.boolean(),
        progress: z.enum(["bar", "path_map"]),
        badges: z.array(Badge).max(8),
        streak: z.boolean(),
        summaryScreen: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type Gamification = z.infer<typeof Gamification>;

export const ThemeOverrides = z
  .object({
    primary: hex,
    secondary: hex,
    accent: hex,
    background: hex,
    surface: hex,
    text: hex,
    mutedText: hex,
    border: hex,
  })
  .partial()
  .strict();
export type ThemeOverrides = z.infer<typeof ThemeOverrides>;

export const FlowSpec = z
  .object({
    variantKey: Slug,
    title: z.string().min(1).max(80),
    tagline: z.string().min(1).max(160),
    gamification: Gamification,
    steps: z.array(Step).min(3).max(12),
    themeOverrides: ThemeOverrides.optional(),
  })
  .strict();
export type FlowSpec = z.infer<typeof FlowSpec>;

export const flowSpecJsonSchema = z.toJSONSchema(FlowSpec);

export type ValidateResult = { ok: true; spec: FlowSpec } | { ok: false; errors: string[] };

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === "number") return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, "");
}

/** Cross-field rules. Returns readable messages; an empty array means the spec is coherent. */
export function semanticErrors(spec: FlowSpec): string[] {
  const errors: string[] = [];
  const steps = spec.steps;
  const seen = new Map<string, number>();

  steps.forEach((step, i) => {
    const at = `steps[${i}] ("${step.id}")`;
    if (seen.has(step.id)) errors.push(`${at}: duplicate step id "${step.id}" (first used at steps[${seen.get(step.id)}])`);
    else seen.set(step.id, i);

    if ("options" in step) {
      const ids = step.options.map((o) => o.id);
      const dup = ids.find((id, j) => ids.indexOf(id) !== j);
      if (dup) errors.push(`${at}: duplicate option id "${dup}"`);
    }
    if (step.type === "checklist") {
      const ids = step.items.map((o) => o.id);
      const dup = ids.find((id, j) => ids.indexOf(id) !== j);
      if (dup) errors.push(`${at}: duplicate checklist item id "${dup}"`);
    }
    if (step.type === "multiple_choice") {
      const n = step.options.length;
      if (step.minSelect !== undefined && step.minSelect > n) errors.push(`${at}: minSelect ${step.minSelect} exceeds the ${n} options`);
      if (step.maxSelect !== undefined && step.minSelect !== undefined && step.maxSelect < step.minSelect)
        errors.push(`${at}: maxSelect ${step.maxSelect} is below minSelect ${step.minSelect}`);
    }
    if (step.type === "quiz_question") {
      const optionIds = new Set(step.options.map((o) => o.id));
      for (const id of step.correctOptionIds) {
        if (!optionIds.has(id)) errors.push(`${at}: correct option "${id}" is not one of its options (${[...optionIds].join(", ")})`);
      }
      if (new Set(step.correctOptionIds).size !== step.correctOptionIds.length) errors.push(`${at}: correctOptionIds has duplicates`);
      if (step.correctOptionIds.length >= step.options.length) errors.push(`${at}: every option is marked correct`);
    }

    if (step.showIf) {
      const conds = [...(step.showIf.all ?? []), ...(step.showIf.any ?? [])];
      if (conds.length === 0) errors.push(`${at}: showIf needs at least one condition in "all" or "any"`);
      for (const c of conds) {
        const ref = steps.findIndex((s) => s.id === c.stepId);
        if (ref === -1) {
          errors.push(`${at}: showIf references unknown step "${c.stepId}"`);
          continue;
        }
        if (ref >= i) {
          errors.push(`${at}: showIf references "${c.stepId}", which does not come before this step`);
          continue;
        }
        if (c.op !== "answered" && c.value === undefined) errors.push(`${at}: showIf condition "${c.op}" on "${c.stepId}" needs a value`);
        const target = steps[ref];
        if (c.value !== undefined && c.op !== "answered" && "options" in target && !target.options.some((o) => o.id === c.value))
          errors.push(`${at}: showIf value "${c.value}" is not an option id of "${c.stepId}"`);
        if (c.value !== undefined && c.op !== "answered" && target.type === "checklist" && !target.items.some((o) => o.id === c.value))
          errors.push(`${at}: showIf value "${c.value}" is not an item id of "${c.stepId}"`);
      }
    }
  });

  if (steps[0] && steps[0].type !== "welcome") errors.push(`steps[0]: first step must be "welcome", got "${steps[0].type}"`);
  const last = steps[steps.length - 1];
  if (last && last.type !== "reward") errors.push(`steps[${steps.length - 1}]: last step must be "reward", got "${last.type}"`);
  if (steps[0]?.showIf) errors.push(`steps[0]: the welcome step cannot have showIf`);
  if (last?.showIf) errors.push(`steps[${steps.length - 1}]: the reward step cannot have showIf`);
  steps.forEach((s, i) => {
    if (s.type === "welcome" && i !== 0) errors.push(`steps[${i}] ("${s.id}"): "welcome" is only allowed as the first step`);
    if (s.type === "reward" && i !== steps.length - 1) errors.push(`steps[${i}] ("${s.id}"): "reward" is only allowed as the last step`);
  });

  const emails = steps.filter((s) => s.type === "email_signup");
  if (emails.length > 1) errors.push(`at most one email_signup step is allowed, found ${emails.length} (${emails.map((s) => s.id).join(", ")})`);

  const badgeIds = new Set<string>();
  const quizCount = steps.filter((s) => s.type === "quiz_question").length;
  const countable = steps.filter((s) => s.type !== "welcome" && s.type !== "reward").length;
  const ceiling = steps.reduce((sum, s) => {
    const award = s.points ?? BASE_POINTS[s.type];
    return sum + (s.type === "checklist" ? award * s.items.length : award);
  }, 0);
  spec.gamification.mechanics.badges.forEach((b, i) => {
    const at = `gamification.mechanics.badges[${i}] ("${b.id}")`;
    if (badgeIds.has(b.id)) errors.push(`${at}: duplicate badge id "${b.id}"`);
    badgeIds.add(b.id);
    const r = b.rule;
    if (r.kind === "step_completed" && !seen.has(r.stepId)) errors.push(`${at}: rule references unknown step "${r.stepId}"`);
    if (r.kind === "quiz_correct" && r.count > quizCount)
      errors.push(`${at}: needs ${r.count} correct quiz answers but the flow has ${quizCount} quiz_question steps`);
    if (r.kind === "points_at_least" && r.points > ceiling)
      errors.push(`${at}: needs ${r.points} points but the flow can award at most ${ceiling}`);
    if (r.kind === "steps_completed" && r.count > countable)
      errors.push(`${at}: needs ${r.count} completed steps but the flow has ${countable} steps between welcome and reward`);
  });

  return errors;
}

export function validateFlowSpec(json: unknown): ValidateResult {
  let input = json;
  if (typeof json === "string") {
    try {
      input = JSON.parse(json);
    } catch (e) {
      return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
    }
  }
  const parsed = FlowSpec.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((iss) => `${formatPath(iss.path) || "(root)"}: ${iss.message}`),
    };
  }
  const errors = semanticErrors(parsed.data);
  return errors.length ? { ok: false, errors } : { ok: true, spec: parsed.data };
}
