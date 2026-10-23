import { desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { BadRequestError, NotFoundError } from "./errors";

export interface QueueGrade {
  gradeId: string;
  learnerName: string;
  learnerRole: string;
  cardPrompt: string;
  competency: string;
  answer: string;
  scores: t.Scores;
  evidenceQuote: string;
  feedback: string;
  gap: string;
  modelVersion: string;
  retrievedCorrections: number;
  levels: t.Rubric["levels"] | null;
  createdAt: string;
}

export interface QueueCard {
  cardId: string;
  gymName: string;
  type: t.CardType;
  competency: string;
  prompt: string;
  choices: string[] | null;
  answerIdx: number | null;
  expertAnswer: string | null;
  status: t.CardStatus;
  sourceHeading: string | null;
}

/** Grades no human has looked at yet, and generated or stale cards waiting for approval. */
export async function getReviewQueue(db: DB): Promise<{ grades: QueueGrade[]; cards: QueueCard[] }> {
  const gradeRows = await db
    .select({ grade: t.grades, attempt: t.attempts, card: t.cards, learner: t.learners })
    .from(t.grades)
    .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .innerJoin(t.learners, eq(t.attempts.learnerId, t.learners.id))
    .where(eq(t.grades.reviewed, false))
    .orderBy(desc(t.grades.createdAt))
    .limit(50);

  const cardRows = await db
    .select({ card: t.cards, gym: t.gyms, chunk: t.docChunks })
    .from(t.cards)
    .innerJoin(t.gyms, eq(t.cards.gymId, t.gyms.id))
    .leftJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .orderBy(desc(t.cards.createdAt));

  return {
    grades: gradeRows.map(({ grade, attempt, card, learner }) => ({
      gradeId: grade.id,
      learnerName: learner.name,
      learnerRole: learner.role,
      cardPrompt: card.prompt,
      competency: card.competency,
      answer: attempt.answerText ?? "",
      scores: grade.scores,
      evidenceQuote: grade.evidenceQuote,
      feedback: grade.feedback,
      gap: grade.gap,
      modelVersion: grade.modelVersion,
      retrievedCorrections: grade.retrievedCorrectionIds.length,
      levels: card.rubric?.levels ?? null,
      createdAt: grade.createdAt.toISOString(),
    })),
    cards: cardRows
      .filter(({ card }) => card.status === "draft" || card.status === "stale")
      .map(({ card, gym, chunk }) => ({
        cardId: card.id,
        gymName: gym.name,
        type: card.type,
        competency: card.competency,
        prompt: card.prompt,
        choices: card.choices,
        answerIdx: card.answerIdx,
        expertAnswer: card.expertAnswer,
        status: card.status,
        sourceHeading: chunk?.heading ?? null,
      })),
  };
}

export interface CardEdits {
  prompt?: string;
  choices?: string[];
  answerIdx?: number;
  expertAnswer?: string;
}

/** Approve, edit (and approve) or reject a generated card. Each decision is stored as a `generate` correction. */
export async function reviewCard(db: DB, cardId: string, action: "approve" | "edit" | "reject", reviewer: string, edits: CardEdits = {}) {
  const [card] = await db.select().from(t.cards).where(eq(t.cards.id, cardId));
  if (!card) throw new NotFoundError(`Card ${cardId} not found`);
  if (action === "edit" && !Object.keys(edits).length) throw new BadRequestError("An edit needs at least one changed field");
  if (edits.choices && edits.answerIdx != null && (edits.answerIdx < 0 || edits.answerIdx >= edits.choices.length)) {
    throw new BadRequestError("answerIdx must point at one of the choices");
  }

  const before = { prompt: card.prompt, choices: card.choices, answerIdx: card.answerIdx, expertAnswer: card.expertAnswer };
  const status: t.CardStatus = action === "reject" ? "rejected" : "approved";
  const changes = action === "edit" ? edits : {};
  const [updated] = await db
    .update(t.cards)
    .set({ ...changes, status })
    .where(eq(t.cards.id, cardId))
    .returning();
  await db.insert(t.cardReviews).values({ cardId, action, before, after: action === "edit" ? { ...before, ...edits } : null, reviewer });

  // A gym held back for review opens once its last draft is decided and it has something to play.
  const [gym] = await db.select().from(t.gyms).where(eq(t.gyms.id, card.gymId));
  if (gym?.locked) {
    const rest = await db.select({ status: t.cards.status }).from(t.cards).where(eq(t.cards.gymId, gym.id));
    if (!rest.some((c) => c.status === "draft") && rest.some((c) => c.status === "approved")) {
      await db.update(t.gyms).set({ locked: false }).where(eq(t.gyms.id, gym.id));
    }
  }
  return updated;
}
