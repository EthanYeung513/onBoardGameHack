import { z } from "zod";

// Fixed bank of clarifying questions. The model chooses from these keys and phrases them for the
// company; it cannot invent new keys.

export const QUESTION_BANK = {
  signup_fields: { intent: "What to collect at sign-up (email only, name, role, company size, use case)", kind: "multi" },
  success_moment: { intent: "The moment a new user first gets value, which the flow should lead to", kind: "single" },
  tone: { intent: "Tone of voice for the onboarding copy relative to the site", kind: "single" },
  playfulness: { intent: "How playful the gamification should be, from subtle to game-like", kind: "single" },
  max_steps: { intent: "The most steps a new user should see", kind: "single" },
  audience_focus: { intent: "Which audience segment the onboarding should prioritise", kind: "single" },
  reward_style: { intent: "What kind of reward feels right at the end (badge, summary, discount, next step link)", kind: "single" },
} as const;

export type QuestionKey = keyof typeof QUESTION_BANK;
export const QUESTION_KEYS = Object.keys(QUESTION_BANK) as QuestionKey[];

export const ChosenQuestions = z.object({
  questions: z
    .array(
      z.object({
        key: z.enum(QUESTION_KEYS as [QuestionKey, ...QuestionKey[]]),
        prompt: z.string().min(5).max(240),
        options: z.array(z.string().min(1).max(80)).max(6),
      }),
    )
    .min(3)
    .max(5),
});
export type ChosenQuestions = z.infer<typeof ChosenQuestions>;

export function checkChosen(c: ChosenQuestions): string[] {
  const keys = c.questions.map((q) => q.key);
  const errors: string[] = [];
  if (new Set(keys).size !== keys.length) errors.push("questions: each key may be used once");
  for (const q of c.questions) {
    if (q.options.length < 2) errors.push(`questions.${q.key}: choice questions need 2 to 6 options`);
  }
  return errors;
}

/** Defaults used when a question was not asked. */
export const ANSWER_DEFAULTS: Record<QuestionKey, string | string[]> = {
  signup_fields: ["email"],
  success_moment: "Completes the first key action on the product",
  tone: "Match the site",
  playfulness: "Balanced",
  max_steps: "8",
  audience_focus: "The primary audience on the site",
  reward_style: "Badge and summary",
};
