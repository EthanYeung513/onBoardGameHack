import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";

/** Mubit starts training a task once it has this many kept examples (PLAN.md §10; confirm with Mubit). */
export const TRAINING_THRESHOLD = 25;

export interface TimelineVersion {
  label: string;
  model: string;
  status: t.ModelVersionStatus;
  heldOutAgreement: number | null;
  withinOne: number | null;
  mae: number | null;
  costPer1k: number | null;
  p50Ms: number | null;
  trainedAt: string | null;
}

export interface Timeline {
  counts: { grades: number; reviewed: number; corrections: number; approvals: number; sentToMubit: number; fastPathGrades: number };
  trainingThreshold: number;
  versions: TimelineVersion[];
  corrections: { id: string; createdAt: string; reviewer: string; reason: string; competency: string; from: number; to: number; sentToMubit: boolean }[];
  liveGrades: { id: string; createdAt: string; learnerName: string; competency: string; score: number; modelVersion: string; retrievedCorrections: number; latencyMs: number }[];
}

const firstScore = (scores: t.Scores) => Object.values(scores)[0] ?? 0;

/** The story of the grader learning: verdicts in, corrections out, versions measured on the held-out set. */
export async function getTimeline(db: DB): Promise<Timeline> {
  const [counts] = await db
    .select({
      grades: sql<number>`count(*)::int`,
      reviewed: sql<number>`count(*) filter (where ${t.grades.reviewed})::int`,
      fastPathGrades: sql<number>`count(*) filter (where jsonb_array_length(${t.grades.retrievedCorrectionIds}) > 0)::int`,
    })
    .from(t.grades);
  const [corr] = await db
    .select({ corrections: sql<number>`count(*)::int`, sentToMubit: sql<number>`count(*) filter (where ${t.corrections.sentToMubit})::int` })
    .from(t.corrections);

  const versions = await db.select().from(t.modelVersions).where(eq(t.modelVersions.task, "grade")).orderBy(t.modelVersions.createdAt);

  const recentCorrections = await db
    .select({ correction: t.corrections, grade: t.grades, card: t.cards })
    .from(t.corrections)
    .innerJoin(t.grades, eq(t.corrections.gradeId, t.grades.id))
    .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .orderBy(desc(t.corrections.createdAt))
    .limit(10);

  const recentGrades = await db
    .select({ grade: t.grades, card: t.cards, learner: t.learners })
    .from(t.grades)
    .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .innerJoin(t.learners, eq(t.attempts.learnerId, t.learners.id))
    .orderBy(desc(t.grades.createdAt))
    .limit(10);

  return {
    counts: { ...counts, ...corr, approvals: Math.max(0, counts.reviewed - corr.corrections) },
    trainingThreshold: TRAINING_THRESHOLD,
    versions: versions.map((v) => ({
      label: v.label,
      model: v.model,
      status: v.status,
      heldOutAgreement: v.heldOutAgreement,
      withinOne: v.withinOne,
      mae: v.mae,
      costPer1k: v.costPer1k,
      p50Ms: v.p50Ms,
      trainedAt: v.trainedAt?.toISOString() ?? null,
    })),
    corrections: recentCorrections.map(({ correction, grade, card }) => ({
      id: correction.id,
      createdAt: correction.createdAt.toISOString(),
      reviewer: correction.reviewer,
      reason: correction.reason,
      competency: card.competency,
      from: firstScore(grade.scores),
      to: firstScore(correction.correctedScores),
      sentToMubit: correction.sentToMubit,
    })),
    liveGrades: recentGrades.map(({ grade, card, learner }) => ({
      id: grade.id,
      createdAt: grade.createdAt.toISOString(),
      learnerName: learner.name,
      competency: card.competency,
      score: firstScore(grade.scores),
      modelVersion: grade.modelVersion,
      retrievedCorrections: grade.retrievedCorrectionIds.length,
      latencyMs: grade.latencyMs,
    })),
  };
}
