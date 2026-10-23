import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { toPublicCard, type PublicCard } from "./world";

export const BOSS_DECK_SIZE = 4;
export const WEAK_SHARE = 0.6;

/** Counts one answer towards the learner's record for a competency. `delta` lets a correction move a fail. */
export async function recordOutcome(db: DB, learnerId: string, competency: string, change: { attempts: number; fails: number }) {
  await db
    .insert(t.weaknesses)
    .values({ learnerId, competency, attempts: Math.max(0, change.attempts), fails: Math.max(0, change.fails) })
    .onConflictDoUpdate({
      target: [t.weaknesses.learnerId, t.weaknesses.competency],
      set: {
        attempts: sql`greatest(0, ${t.weaknesses.attempts} + ${change.attempts})`,
        fails: sql`greatest(0, ${t.weaknesses.fails} + ${change.fails})`,
      },
    });
}

export interface Weakness {
  competency: string;
  attempts: number;
  fails: number;
  failRate: number;
}

/** Competencies the learner has failed at least once, worst first. */
export async function getWeaknesses(db: DB, learnerId: string): Promise<Weakness[]> {
  const rows = await db.select().from(t.weaknesses).where(eq(t.weaknesses.learnerId, learnerId));
  return rows
    .filter((r) => r.fails > 0)
    .map((r) => ({ competency: r.competency, attempts: r.attempts, fails: r.fails, failRate: r.attempts ? r.fails / r.attempts : 1 }))
    .sort((a, b) => b.failRate - a.failRate || b.fails - a.fails);
}

/**
 * The Gym Leader's deck. At least 60% of it targets competencies the learner has failed, when the gym has cards
 * for them. Within a weak competency, scenarios the learner hasn't just failed come first, so a retry tests the
 * same skill with a different situation. The rest is the gym's boss cards.
 */
export async function getBossDeck(db: DB, learnerId: string, gymId: string, size = BOSS_DECK_SIZE): Promise<PublicCard[]> {
  const candidates = (await db
    .select()
    .from(t.cards)
    .where(and(eq(t.cards.gymId, gymId), eq(t.cards.status, "approved"))))
    .filter((c) => c.type !== "phish_email");
  const deckSize = Math.min(size, candidates.length);
  const weakRank = new Map((await getWeaknesses(db, learnerId)).map((w, i) => [w.competency, i]));

  const lastResult = new Map<string, boolean>();
  for (const a of await db.select().from(t.attempts).where(eq(t.attempts.learnerId, learnerId)).orderBy(desc(t.attempts.createdAt))) {
    if (!lastResult.has(a.cardId)) lastResult.set(a.cardId, a.correct);
  }
  const justFailed = (c: (typeof candidates)[number]) => lastResult.get(c.id) === false;

  const weak = candidates
    .filter((c) => weakRank.has(c.competency))
    .sort((a, b) => Number(justFailed(a)) - Number(justFailed(b)) || weakRank.get(a.competency)! - weakRank.get(b.competency)! || Number(b.isBoss) - Number(a.isBoss));
  const weakSlots = Math.min(weak.length, Math.max(Math.ceil(deckSize * WEAK_SHARE), deckSize - candidates.filter((c) => !weakRank.has(c.competency)).length));

  const deck = weak.slice(0, weakSlots);
  const rest = candidates
    .filter((c) => !deck.includes(c))
    .sort((a, b) => Number(b.isBoss) - Number(a.isBoss) || a.createdAt.getTime() - b.createdAt.getTime());
  deck.push(...rest.slice(0, deckSize - deck.length));
  // The hardest card (a boss card, if any) goes last.
  deck.sort((a, b) => Number(a.isBoss) - Number(b.isBoss));
  return deck.map(toPublicCard);
}
