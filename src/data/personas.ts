import { z } from "zod";
import type { LlmClient } from "../llm/types";
import { TASKS } from "../tasks/registry";

/** The personas from PLAN.md §8: a spread of good and bad answers so the grader has disagreements to learn from. */
export const PERSONAS = {
  beginner: "A nervous first-week hire who doesn't know the policy yet and tends to defer or guess.",
  careless: "A hire in a hurry who takes the quickest route and skips checks to keep the customer happy.",
  "over-promiser": "A friendly hire who wants to please and promises outcomes and dates they can't guarantee.",
  "policy-literal": "A hire who quotes one rule they remember but misses the other steps or the reason behind it.",
  model: "An experienced hire who follows the company policy fully and explains why.",
} as const;
export type Persona = keyof typeof PERSONAS;

export interface PersonaRequest {
  persona: Persona;
  scenario: string;
  policy: string;
  expertAnswer: string;
  redFlags: string[];
  count: number;
}

const replySchema = z.object({ answers: z.array(z.string().min(5)).min(1) });

export function buildPersonaUserMessage(req: PersonaRequest): string {
  return [
    `## Persona\n${req.persona}: ${PERSONAS[req.persona]}`,
    `## Company policy (what the hire may or may not know)\n${req.policy}`,
    `## Expert answer (for contrast only)\n${req.expertAnswer}`,
    `## Scenario\n${req.scenario}`,
    `## How many answers\n${req.count}`,
  ].join("\n\n");
}

/** Generates `count` answers in a persona's voice. An invalid or short reply is retried once. */
export async function generatePersonaAnswers(llm: LlmClient, model: string, req: PersonaRequest): Promise<string[]> {
  const user = buildPersonaUserMessage(req);
  for (let attempt = 0; attempt < 2; attempt++) {
    const call = await llm.chat({ task: "persona", model, system: TASKS.persona.system, user, meta: req });
    try {
      const { answers } = replySchema.parse(JSON.parse(call.content));
      if (answers.length >= req.count) return answers.slice(0, req.count);
    } catch {
      // fall through to the retry
    }
  }
  throw new Error(`Persona ${req.persona} did not return ${req.count} valid answers`);
}

/** Offline stand-in: templated answers per persona, built from the card's own expert answer and red flags. */
export function offlinePersona(meta: unknown): { answers: string[] } {
  const req = meta as PersonaRequest;
  const flag = req.redFlags[0] ?? "skip the usual checks";
  const templates: Record<Persona, string[]> = {
    beginner: ["I'm not sure, I'd probably ask my team lead what to do.", "I think I'd wait and check with someone before doing anything.", "I'd look it up on the intranet first, I don't know the rule yet."],
    careless: [`I'd just ${flag} to keep things moving.`, `Honestly I'd ${flag}, they sound legit.`, `Quickest fix: ${flag} and move on.`],
    "over-promiser": ["I'd tell them it's sorted today and make sure they're happy.", "I'd promise it'll be done by end of day so they don't worry.", "I'd reassure them it's all fine and fix it straight away."],
    "policy-literal": [req.policy.split("\n").find((l) => l.trim().length > 20)?.replace(/^[-*\d.\s]+/, "").trim() ?? "I'd follow the policy.", "I'd follow the rule in the playbook.", "I'd check the policy says it's allowed."],
    model: [req.expertAnswer, req.expertAnswer.replace(/^I /, "I'd "), req.expertAnswer],
  };
  const pool = templates[req.persona];
  return { answers: Array.from({ length: req.count }, (_, i) => pool[i % pool.length]) };
}
