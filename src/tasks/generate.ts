import { z } from "zod";
import type { CardType } from "@/db/schema";
import type { ChatResult, LlmClient } from "@/llm/types";
import { TASKS } from "./registry";

export interface GenerateInput {
  packTitle: string;
  role: string;
  docTitle: string;
  heading: string;
  text: string;
  type: CardType;
}

const levels = z.object({ "0": z.string().min(1), "1": z.string().min(1), "2": z.string().min(1), "3": z.string().min(1) });

export const generatedCardSchema = z
  .object({
    type: z.enum(["mcq", "free_text", "phish_email", "incident"]),
    competency: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "competency must be kebab-case"),
    prompt: z.string().min(10),
    choices: z.array(z.string().min(1)).nullable(),
    answer_idx: z.number().int().min(0).nullable(),
    levels: levels.nullable(),
    expert_answer: z.string().min(1),
  })
  .superRefine((card, ctx) => {
    const needsChoices = card.type === "mcq" || card.type === "phish_email";
    if (needsChoices) {
      const expected = card.type === "mcq" ? 4 : 2;
      if (card.choices?.length !== expected) ctx.addIssue({ code: "custom", message: `${card.type} needs exactly ${expected} choices` });
      if (card.answer_idx == null || card.answer_idx >= (card.choices?.length ?? 0)) ctx.addIssue({ code: "custom", message: "answer_idx must point at a choice" });
    } else if (!card.levels) {
      ctx.addIssue({ code: "custom", message: `${card.type} needs rubric levels` });
    }
  });
export type GeneratedCard = z.infer<typeof generatedCardSchema>;

export function buildGenerateUserMessage(input: GenerateInput): string {
  return [
    `## Content pack\n${input.packTitle} (role: ${input.role})`,
    `## Card type\n${input.type}`,
    `## Document section\n${input.docTitle} > ${input.heading}\n\n${input.text}`,
  ].join("\n\n");
}

export function validateGenerated(content: string, type: CardType): { ok: true; card: GeneratedCard } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return { ok: false, error: "reply was not valid JSON" };
  }
  const parsed = generatedCardSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "reply did not match the schema" };
  if (parsed.data.type !== type) return { ok: false, error: `asked for a ${type} card, got ${parsed.data.type}` };
  return { ok: true, card: parsed.data };
}

export class GenerateError extends Error {}

/** Writes one card from a doc section. An invalid reply is retried once; a second failure throws. */
export async function generateCard(llm: LlmClient, model: string, input: GenerateInput): Promise<{ card: GeneratedCard; call: ChatResult }> {
  const user = buildGenerateUserMessage(input);
  let call = await llm.chat({ task: "generate", model, system: TASKS.generate.system, user, meta: input });
  let result = validateGenerated(call.content, input.type);
  if (!result.ok) {
    call = await llm.chat({
      task: "generate",
      model,
      system: TASKS.generate.system,
      user: `${user}\n\n## Note\nYour previous reply was rejected: ${result.error}. Reply again with valid JSON only.`,
      meta: input,
    });
    result = validateGenerated(call.content, input.type);
    if (!result.ok) throw new GenerateError(`Generated card invalid after retry: ${result.error}`);
  }
  return { card: result.card, call };
}
