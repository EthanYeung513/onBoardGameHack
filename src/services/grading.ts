import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import type { LlmClient } from "@/llm/types";
import { gradeAnswer, isPassing, type RetrievedCorrection } from "@/tasks/grade";

export interface Citation {
  docTitle: string;
  heading: string;
  text: string;
  docVersion: number;
}

export async function getActiveModel(db: DB, task: string): Promise<{ label: string; model: string }> {
  const [row] = await db
    .select()
    .from(t.modelVersions)
    .where(and(eq(t.modelVersions.task, task), eq(t.modelVersions.status, "promoted")))
    .orderBy(t.modelVersions.createdAt);
  if (!row) throw new Error(`No promoted model version for task "${task}". Run npm run db:seed.`);
  return { label: row.label, model: row.model };
}

/** A card with the pack, gym and doc section it comes from. */
export async function getCardContext(db: DB, cardId: string) {
  const [row] = await db
    .select({ card: t.cards, gym: t.gyms, pack: t.packs, chunk: t.docChunks, doc: t.docs })
    .from(t.cards)
    .innerJoin(t.gyms, eq(t.cards.gymId, t.gyms.id))
    .innerJoin(t.packs, eq(t.gyms.packId, t.packs.id))
    .leftJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .leftJoin(t.docs, eq(t.docChunks.docId, t.docs.id))
    .where(eq(t.cards.id, cardId));
  if (!row) throw new NotFoundError(`Card ${cardId} not found`);
  const citation: Citation | null =
    row.chunk && row.doc ? { docTitle: row.doc.title, heading: row.chunk.heading, text: row.chunk.text, docVersion: row.chunk.docVersion } : null;
  return { ...row, citation };
}

export class NotFoundError extends Error {}
export class BadRequestError extends Error {}

export type Retriever = (db: DB, llm: LlmClient, answer: string, competency: string) => Promise<RetrievedCorrection[]>;

export interface SubmitInput {
  learnerId: string;
  cardId: string;
  answerText?: string;
  choiceIdx?: number;
}

export interface SubmitResult {
  attemptId: string;
  correct: boolean;
  competency: string;
  expertAnswer: string | null;
  correctChoice: string | null;
  citation: Citation | null;
  grade: null | {
    id: string;
    scores: t.Scores;
    evidenceQuote: string;
    feedback: string;
    gap: string;
    modelVersion: string;
    model: string;
    latencyMs: number;
    costUsd: number;
    retrievedCorrections: number;
    mode: LlmClient["mode"];
  };
}

/** Records one answer. Multiple-choice is checked against the key; free text goes to the grader. */
export async function submitAnswer(db: DB, llm: LlmClient, input: SubmitInput, retrieve: Retriever): Promise<SubmitResult> {
  const { card, pack, citation } = await getCardContext(db, input.cardId);
  const [learner] = await db.select().from(t.learners).where(eq(t.learners.id, input.learnerId));
  if (!learner) throw new NotFoundError(`Learner ${input.learnerId} not found`);

  const base = {
    competency: card.competency,
    expertAnswer: card.expertAnswer,
    correctChoice: card.choices && card.answerIdx != null ? card.choices[card.answerIdx] : null,
    citation,
  };

  if (card.type === "mcq" || card.type === "phish_email") {
    if (input.choiceIdx == null) throw new BadRequestError("choiceIdx is required for this card");
    const correct = input.choiceIdx === card.answerIdx;
    const [attempt] = await db
      .insert(t.attempts)
      .values({ learnerId: learner.id, cardId: card.id, choiceIdx: input.choiceIdx, correct })
      .returning();
    return { attemptId: attempt.id, correct, grade: null, ...base };
  }

  const answer = input.answerText?.trim();
  if (!answer) throw new BadRequestError("answerText is required for this card");
  if (!card.rubric) throw new BadRequestError("This card has no rubric to grade against");

  const corrections = await retrieve(db, llm, answer, card.competency);
  const active = await getActiveModel(db, "grade");
  const { grade, call } = await gradeAnswer(llm, active.model, {
    packTitle: pack.title,
    role: pack.role ?? learner.role,
    scenario: card.prompt,
    rubric: card.rubric,
    answer,
    corrections,
  });
  const correct = isPassing(grade.scores);
  const [attempt] = await db.insert(t.attempts).values({ learnerId: learner.id, cardId: card.id, answerText: answer, correct }).returning();
  const [gradeRow] = await db
    .insert(t.grades)
    .values({
      attemptId: attempt.id,
      modelVersion: active.label,
      model: call.model,
      scores: grade.scores,
      evidenceQuote: grade.evidence_quote,
      feedback: grade.feedback,
      gap: grade.gap,
      latencyMs: call.latencyMs,
      costUsd: call.costUsd,
      mubitRequestId: call.requestId,
      retrievedCorrectionIds: corrections.map((c) => c.id),
    })
    .returning();

  return {
    attemptId: attempt.id,
    correct,
    ...base,
    grade: {
      id: gradeRow.id,
      scores: grade.scores,
      evidenceQuote: grade.evidence_quote,
      feedback: grade.feedback,
      gap: grade.gap,
      modelVersion: active.label,
      model: call.model,
      latencyMs: call.latencyMs,
      costUsd: call.costUsd,
      retrievedCorrections: corrections.length,
      mode: llm.mode,
    },
  };
}
