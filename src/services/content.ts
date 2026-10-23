import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { NotFoundError } from "./errors";

/** The demo is single-tenant: the manager console works on the first company. */
export async function getDefaultCompany(db: DB) {
  const [company] = await db.select().from(t.companies).orderBy(asc(t.companies.createdAt)).limit(1);
  if (!company) throw new NotFoundError("No company yet. Run npm run db:seed.");
  return company;
}

export async function listDocs(db: DB, companyId: string) {
  const docs = await db
    .select({ doc: t.docs, pack: t.packs })
    .from(t.docs)
    .innerJoin(t.packs, eq(t.docs.packId, t.packs.id))
    .where(eq(t.packs.companyId, companyId))
    .orderBy(asc(t.packs.createdAt));
  const stale = await db
    .select({ docId: t.docChunks.docId, n: sql<number>`count(*)::int` })
    .from(t.cards)
    .innerJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .where(eq(t.cards.status, "stale"))
    .groupBy(t.docChunks.docId);
  const staleBy = new Map(stale.map((s) => [s.docId, s.n]));
  return docs.map(({ doc, pack }) => ({
    id: doc.id,
    title: doc.title,
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
    packTitle: pack.title,
    staleCards: staleBy.get(doc.id) ?? 0,
  }));
}

export async function getDoc(db: DB, docId: string) {
  const [doc] = await db.select().from(t.docs).where(eq(t.docs.id, docId));
  if (!doc) throw new NotFoundError(`Doc ${docId} not found`);
  return { id: doc.id, title: doc.title, version: doc.version, body: doc.body };
}

/** Approves every draft card in a gym and opens its door. */
export async function publishGym(db: DB, gymId: string, reviewer: string) {
  const [gym] = await db.select().from(t.gyms).where(eq(t.gyms.id, gymId));
  if (!gym) throw new NotFoundError(`Gym ${gymId} not found`);
  const drafts = await db
    .update(t.cards)
    .set({ status: "approved" })
    .where(and(eq(t.cards.gymId, gymId), eq(t.cards.status, "draft")))
    .returning();
  if (drafts.length) await db.insert(t.cardReviews).values(drafts.map((c) => ({ cardId: c.id, action: "approve" as const, reviewer })));
  await db.update(t.gyms).set({ locked: false }).where(eq(t.gyms.id, gymId));
  return { gymId, approved: drafts.length };
}
