import { and, asc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { toPublicCard, type PublicCard } from "./world";

/** The Gym Leader's deck. Made adaptive in T10; for now, the gym's boss cards. */
export async function getBossDeck(db: DB, learnerId: string, gymId: string): Promise<PublicCard[]> {
  void learnerId;
  const rows = await db
    .select()
    .from(t.cards)
    .where(and(eq(t.cards.gymId, gymId), eq(t.cards.status, "approved"), eq(t.cards.isBoss, true)))
    .orderBy(asc(t.cards.createdAt));
  return rows.map(toPublicCard);
}
