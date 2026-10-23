import { z } from "zod";
import type { Rubric, Scores } from "@/db/schema";
import type { ChatResult, LlmClient } from "@/llm/types";
import { TASKS } from "./registry";

/** A past reviewer ruling on a similar answer, retrieved into the grader's user message (the fast path). */
export interface RetrievedCorrection {
  id: string;
  answer: string;
  originalScores: Scores;
  correctedScores: Scores;
  reason: string;
  similarity: number;
}

export interface GradeInput {
  packTitle: string;
  role: string;
  scenario: string;
  rubric: Rubric;
  answer: string;
  corrections: RetrievedCorrection[];
}

export const gradeOutputSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(0).max(3)),
  evidence_quote: z.string(),
  feedback: z.string().min(1),
  gap: z.string().min(1),
});
export type GradeOutput = z.infer<typeof gradeOutputSchema>;

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Parses and checks a grader reply. Returns an error message instead of throwing so the caller can retry. */
export function validateGrade(content: string, input: Pick<GradeInput, "answer" | "rubric">): { ok: true; grade: GradeOutput } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: "reply was not valid JSON" };
  }
  const parsed = gradeOutputSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `reply did not match the schema: ${parsed.error.issues[0]?.message}` };
  const grade = parsed.data;
  if (!(input.rubric.competency in grade.scores)) return { ok: false, error: `missing score for competency "${input.rubric.competency}"` };
  if (!grade.evidence_quote.trim() || !normalise(input.answer).includes(normalise(grade.evidence_quote))) {
    return { ok: false, error: "evidence_quote is not an exact quote from the answer" };
  }
  return { ok: true, grade };
}

/** Everything that varies per call goes here, never in the system prompt. */
export function buildGradeUserMessage(input: GradeInput): string {
  const levels = Object.entries(input.rubric.levels)
    .map(([score, text]) => `- ${score}: ${text}`)
    .join("\n");
  const rulings = input.corrections.length
    ? input.corrections
        .map(
          (c, i) =>
            `Ruling ${i + 1} (similarity ${c.similarity.toFixed(2)}):\nAnswer: ${c.answer}\nGrader said: ${JSON.stringify(c.originalScores)}\nReviewer corrected to: ${JSON.stringify(c.correctedScores)}\nReason: ${c.reason}`,
        )
        .join("\n\n")
    : "None.";
  return [
    `## Content pack\n${input.packTitle} (role: ${input.role})`,
    `## Company policy\n${input.rubric.policy}`,
    `## Rubric\nCompetency: ${input.rubric.competency}\n${levels}`,
    `## Past reviewer rulings on similar answers\n${rulings}`,
    `## Scenario\n${input.scenario}`,
    `## Hire's answer\n${input.answer}`,
  ].join("\n\n");
}

export class GradeError extends Error {}

export interface GradeCallResult {
  grade: GradeOutput;
  call: ChatResult;
}

/** Grades one answer. An invalid reply is retried once with the validation error; a second failure throws. */
export async function gradeAnswer(llm: LlmClient, model: string, input: GradeInput): Promise<GradeCallResult> {
  const user = buildGradeUserMessage(input);
  let call = await llm.chat({ task: "grade", model, system: TASKS.grade.system, user, meta: input });
  let result = validateGrade(call.content, input);
  if (!result.ok) {
    const retryUser = `${user}\n\n## Note\nYour previous reply was rejected: ${result.error}. Reply again with valid JSON only.`;
    const retry = await llm.chat({ task: "grade", model, system: TASKS.grade.system, user: retryUser, meta: input });
    call = { ...retry, latencyMs: call.latencyMs + retry.latencyMs, costUsd: call.costUsd + retry.costUsd };
    result = validateGrade(call.content, input);
    if (!result.ok) throw new GradeError(`Grader reply invalid after retry: ${result.error}`);
  }
  return { grade: result.grade, call };
}

/** A grade passes when every competency scores 2 or more. */
export const isPassing = (scores: Scores) => Object.values(scores).every((s) => s >= 2);
