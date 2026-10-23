import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as t from "../db/schema";
import type { LlmClient } from "../llm/types";
import { retrieveCorrections } from "../services/corrections";
import { submitAnswer } from "../services/grading";

export interface PersonaAnswer {
  card: string;
  persona: string;
  answer: string;
}

/**
 * Grades synthetic answers through the normal grading path, one learner per persona. Every call goes through Mubit,
 * so this is the bulk traffic that fills the task's kept examples, and the grades land in the review queue.
 */
export async function bulkGrade(db: DB, llm: LlmClient, items: PersonaAnswer[], concurrency = 4) {
  const [company] = await db.select().from(t.companies).limit(1);
  if (!company) throw new Error("No company. Run npm run db:seed first.");
  const cards = await db.select().from(t.cards).where(eq(t.cards.type, "free_text"));
  const learners = new Map<string, string>();
  for (const persona of new Set(items.map((i) => i.persona))) {
    const [learner] = await db.insert(t.learners).values({ companyId: company.id, name: `Persona: ${persona}`, role: "Synthetic" }).returning();
    learners.set(persona, learner.id);
  }

  let graded = 0;
  const failures: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      const card = cards.find((c) => c.prompt.startsWith(item.card) && c.status === "approved");
      if (!card) {
        failures.push(`no approved free-text card starts with "${item.card}"`);
        continue;
      }
      try {
        await submitAnswer(db, llm, { learnerId: learners.get(item.persona)!, cardId: card.id, answerText: item.answer }, retrieveCorrections);
        graded++;
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { graded, failures };
}
