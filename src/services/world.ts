import { and, asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { BadRequestError, NotFoundError } from "./errors";

/** A card as the player sees it: no answer key, expert answer or rubric. */
export interface PublicCard {
  id: string;
  type: t.CardType;
  competency: string;
  prompt: string;
  choices: string[] | null;
  isBoss: boolean;
}

export const toPublicCard = (c: typeof t.cards.$inferSelect): PublicCard => ({
  id: c.id,
  type: c.type,
  competency: c.competency,
  prompt: c.prompt,
  choices: c.choices,
  isBoss: c.isBoss,
});

export async function joinCompany(db: DB, input: { joinCode: string; name: string; role: string }) {
  const [company] = await db.select().from(t.companies).where(eq(t.companies.joinCode, input.joinCode.trim().toUpperCase()));
  if (!company) throw new BadRequestError("Unknown company code");
  const [learner] = await db.insert(t.learners).values({ companyId: company.id, name: input.name.trim(), role: input.role }).returning();
  return { learner, company: { id: company.id, name: company.name } };
}

export interface WorldGym {
  id: string;
  name: string;
  leaderName: string;
  building: string;
  locked: boolean;
  packTitle: string;
  packType: t.PackType;
  forYou: boolean;
  cleared: boolean;
}

/** Everything the play screen needs: the learner, every gym with its state, and which doors are locked. */
export async function getWorld(db: DB, learnerId: string) {
  const [learner] = await db.select().from(t.learners).where(eq(t.learners.id, learnerId));
  if (!learner) throw new NotFoundError("Learner not found");
  const [company] = await db.select().from(t.companies).where(eq(t.companies.id, learner.companyId));
  const rows = await db
    .select({ gym: t.gyms, pack: t.packs })
    .from(t.gyms)
    .innerJoin(t.packs, eq(t.gyms.packId, t.packs.id))
    .where(eq(t.packs.companyId, learner.companyId))
    .orderBy(asc(t.gyms.order));
  const earned = new Set((await db.select().from(t.badges).where(eq(t.badges.learnerId, learnerId))).map((b) => b.gymId));

  const gyms: WorldGym[] = rows.map(({ gym, pack }) => ({
    id: gym.id,
    name: gym.name,
    leaderName: gym.leaderName,
    building: gym.building,
    locked: gym.locked,
    packTitle: pack.title,
    packType: pack.type,
    forYou: pack.type !== "role" || pack.role === learner.role,
    cleared: earned.has(gym.id),
  }));
  const open = new Set(gyms.filter((g) => !g.locked).map((g) => g.building));
  // The annex is the building a newly uploaded pack moves into; it stays locked until then.
  const locked = [...new Set([...gyms.filter((g) => g.locked).map((g) => g.building), "annex"])].filter((b) => !open.has(b));
  return { company: { name: company.name }, learner: { id: learner.id, name: learner.name, role: learner.role }, gyms, locked };
}

/** Trainer battles: the gym's approved non-boss cards. Phishing emails are saved for wild encounters. */
export async function getTrainerDeck(db: DB, gymId: string): Promise<PublicCard[]> {
  const rows = await db
    .select()
    .from(t.cards)
    .where(and(eq(t.cards.gymId, gymId), eq(t.cards.status, "approved"), eq(t.cards.isBoss, false)))
    .orderBy(asc(t.cards.createdAt));
  return rows.filter((c) => c.type !== "phish_email").map(toPublicCard);
}

/** A random approved phishing email from any of the company's gyms. */
export async function getEncounterCard(db: DB, learnerId: string, rng: () => number = Math.random): Promise<PublicCard> {
  const [learner] = await db.select().from(t.learners).where(eq(t.learners.id, learnerId));
  if (!learner) throw new NotFoundError("Learner not found");
  const gymIds = (
    await db.select({ id: t.gyms.id }).from(t.gyms).innerJoin(t.packs, eq(t.gyms.packId, t.packs.id)).where(eq(t.packs.companyId, learner.companyId))
  ).map((g) => g.id);
  const pool = gymIds.length
    ? await db
        .select()
        .from(t.cards)
        .where(and(inArray(t.cards.gymId, gymIds), eq(t.cards.type, "phish_email"), eq(t.cards.status, "approved")))
    : [];
  if (!pool.length) throw new NotFoundError("No phishing emails yet");
  return toPublicCard(pool[Math.floor(rng() * pool.length)]);
}

/** Awards a gym badge. The learner must have answered at least one of the gym's cards correctly. */
export async function awardBadge(db: DB, learnerId: string, gymId: string) {
  const correct = await db
    .select({ id: t.attempts.id })
    .from(t.attempts)
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .where(and(eq(t.attempts.learnerId, learnerId), eq(t.cards.gymId, gymId), eq(t.attempts.correct, true)))
    .limit(1);
  if (!correct.length) throw new BadRequestError("Beat the gym's battles before claiming its badge");
  await db.insert(t.badges).values({ learnerId, gymId }).onConflictDoNothing();
  return { learnerId, gymId };
}
