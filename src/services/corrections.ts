import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { cosine } from "@/llm/embeddings";
import type { LlmClient } from "@/llm/types";
import { isPassing, type RetrievedCorrection } from "@/tasks/grade";
import type { FeedbackSink } from "./feedback";
import { recordOutcome } from "./adaptive";
import { BadRequestError, NotFoundError } from "./errors";
import type { Retriever } from "./grading";

export const TOP_K = 3;
export const MIN_SIMILARITY = 0.35;

/**
 * The fast path: finds reviewer rulings on answers similar to this one, for the same competency, so the grader
 * applies the new standard on the very next call. Corrections flagged for re-review (policy changed) are skipped.
 */
export const retrieveCorrections: Retriever = async (db, llm, answer, competency) => {
  const rows = await db
    .select({ correction: t.corrections, grade: t.grades, attempt: t.attempts })
    .from(t.corrections)
    .innerJoin(t.grades, eq(t.corrections.gradeId, t.grades.id))
    .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .where(and(eq(t.cards.competency, competency), eq(t.corrections.needsReview, false)));
  if (!rows.length) return [];

  const [query] = await llm.embed([answer]);
  return rows
    .map(
      (r): RetrievedCorrection => ({
        id: r.correction.id,
        answer: r.attempt.answerText ?? "",
        originalScores: r.grade.scores,
        correctedScores: r.correction.correctedScores,
        reason: r.correction.reason,
        similarity: cosine(query, r.correction.embedding),
      }),
    )
    .filter((c) => c.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, TOP_K);
};

async function loadGrade(db: DB, gradeId: string) {
  const [row] = await db
    .select({ grade: t.grades, attempt: t.attempts, card: t.cards })
    .from(t.grades)
    .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .where(eq(t.grades.id, gradeId));
  if (!row) throw new NotFoundError(`Grade ${gradeId} not found`);
  return row;
}

export interface CorrectionInput {
  gradeId: string;
  correctedScores: t.Scores;
  reason: string;
  reviewer: string;
}

/** A reviewer overrides a grade: stored, embedded for retrieval, applied to the attempt, and sent to the sink. */
export async function createCorrection(db: DB, llm: LlmClient, sink: FeedbackSink, input: CorrectionInput) {
  const { grade, attempt, card } = await loadGrade(db, input.gradeId);
  const expected = Object.keys(grade.scores).sort();
  const given = Object.keys(input.correctedScores).sort();
  if (expected.join() !== given.join()) throw new BadRequestError(`correctedScores must cover exactly: ${expected.join(", ")}`);
  if (Object.values(input.correctedScores).some((s) => !Number.isInteger(s) || s < 0 || s > 3)) throw new BadRequestError("Scores must be 0 to 3");
  if (!input.reason.trim()) throw new BadRequestError("A one-line reason is required");

  const [embedding] = await llm.embed([attempt.answerText ?? ""]);
  const [correction] = await db
    .insert(t.corrections)
    .values({
      gradeId: grade.id,
      correctedScores: input.correctedScores,
      reason: input.reason.trim(),
      reviewer: input.reviewer,
      embedding,
      docVersion: card.docVersion,
    })
    .returning();
  await db.update(t.grades).set({ reviewed: true }).where(eq(t.grades.id, grade.id));
  const nowCorrect = isPassing(input.correctedScores);
  await db.update(t.attempts).set({ correct: nowCorrect }).where(eq(t.attempts.id, attempt.id));
  // The reviewer's verdict replaces the grader's in the learner's record, so the boss targets the right gaps.
  if (nowCorrect !== attempt.correct) await recordOutcome(db, attempt.learnerId, card.competency, { attempts: 0, fails: nowCorrect ? -1 : 1 });

  const feedback = await sink.send({
    kind: "correction",
    task: "grade",
    requestId: grade.mubitRequestId,
    scenario: card.prompt,
    answer: attempt.answerText ?? "",
    original: grade.scores,
    corrected: input.correctedScores,
    reason: input.reason,
    reviewer: input.reviewer,
  });
  if (feedback.delivered) await db.update(t.corrections).set({ sentToMubit: true }).where(eq(t.corrections.id, correction.id));
  return { correction: { ...correction, sentToMubit: feedback.delivered }, feedback };
}

/** A reviewer confirms a grade as correct. That is a training signal too. */
export async function approveGrade(db: DB, sink: FeedbackSink, gradeId: string, reviewer: string) {
  const { grade, attempt, card } = await loadGrade(db, gradeId);
  await db.update(t.grades).set({ reviewed: true }).where(eq(t.grades.id, grade.id));
  const feedback = await sink.send({
    kind: "approval",
    task: "grade",
    requestId: grade.mubitRequestId,
    scenario: card.prompt,
    answer: attempt.answerText ?? "",
    original: grade.scores,
    corrected: grade.scores,
    reason: "Approved as graded",
    reviewer,
  });
  return { gradeId, feedback };
}
