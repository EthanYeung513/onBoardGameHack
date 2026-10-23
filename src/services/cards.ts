import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { defaultModel } from "@/llm/env";
import type { LlmClient } from "@/llm/types";
import { generateCard } from "@/tasks/generate";
import { sectionRules, signalsFromRules } from "@/tasks/offline-generate";
import { NotFoundError } from "./errors";

/** The promoted model for a task, or the default frontier model when none has been recorded. */
export async function modelFor(db: DB, task: string): Promise<string> {
  const [row] = await db
    .select()
    .from(t.modelVersions)
    .where(and(eq(t.modelVersions.task, task), eq(t.modelVersions.status, "promoted")));
  return row?.model ?? defaultModel();
}

export interface CreateCardInput {
  chunkId: string;
  gymId: string;
  type: t.CardType;
  role: string;
  isBoss?: boolean;
  status?: t.CardStatus;
}

/** Generates a draft card from one doc section. The card cites that section and its doc version. */
export async function createCardFromChunk(db: DB, llm: LlmClient, input: CreateCardInput) {
  const [row] = await db
    .select({ chunk: t.docChunks, doc: t.docs, pack: t.packs })
    .from(t.docChunks)
    .innerJoin(t.docs, eq(t.docChunks.docId, t.docs.id))
    .innerJoin(t.packs, eq(t.docs.packId, t.packs.id))
    .where(eq(t.docChunks.id, input.chunkId));
  if (!row) throw new NotFoundError(`Doc section ${input.chunkId} not found`);

  const { card } = await generateCard(llm, await modelFor(db, "generate"), {
    packTitle: row.pack.title,
    role: input.role,
    docTitle: row.doc.title,
    heading: row.chunk.heading,
    text: row.chunk.text,
    type: input.type,
  });

  const rubric: t.Rubric | null = card.levels
    ? { competency: card.competency, policy: row.chunk.text, levels: card.levels, signals: signalsFromRules(sectionRules(row.chunk.text)) }
    : null;
  const [inserted] = await db
    .insert(t.cards)
    .values({
      gymId: input.gymId,
      type: card.type,
      competency: card.competency,
      prompt: card.prompt,
      choices: card.choices,
      answerIdx: card.answer_idx,
      rubric,
      expertAnswer: card.expert_answer,
      sourceChunkId: row.chunk.id,
      docVersion: row.chunk.docVersion,
      status: input.status ?? "draft",
      isBoss: input.isBoss ?? false,
    })
    .returning();
  return inserted;
}
