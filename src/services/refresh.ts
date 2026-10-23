import { and, eq, inArray, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { chunkMarkdown, markdownTitle } from "@/lib/chunk";
import type { LlmClient } from "@/llm/types";
import { createCardFromChunk } from "./cards";
import { BadRequestError, NotFoundError } from "./errors";

/** The building a newly uploaded pack moves into (the locked door on the map). */
export const ANNEX = "annex";

async function insertChunks(db: DB, docId: string, version: number, body: string) {
  const chunks = chunkMarkdown(body);
  if (!chunks.length) return [];
  return db
    .insert(t.docChunks)
    .values(chunks.map((c) => ({ docId, docVersion: version, ord: c.ord, heading: c.heading, text: c.text })))
    .returning();
}

export interface DocUpdateResult {
  docId: string;
  version: number;
  staleCards: number;
  carriedOver: number;
  flaggedCorrections: number;
}

/**
 * A policy edit. The doc gets a new version and new chunks. Cards whose section text is unchanged move to the new
 * version; cards whose section changed or disappeared go stale (hidden from players until regenerated and
 * approved), and corrections made under the old wording are flagged for re-review and left out of the fast path.
 */
export async function updateDoc(db: DB, docId: string, body: string): Promise<DocUpdateResult> {
  const [doc] = await db.select().from(t.docs).where(eq(t.docs.id, docId));
  if (!doc) throw new NotFoundError(`Doc ${docId} not found`);
  if (!body.trim()) throw new BadRequestError("The document can't be empty");
  if (body === doc.body) return { docId, version: doc.version, staleCards: 0, carriedOver: 0, flaggedCorrections: 0 };

  const version = doc.version + 1;
  await db.update(t.docs).set({ body, version, updatedAt: new Date() }).where(eq(t.docs.id, docId));
  const fresh = new Map((await insertChunks(db, docId, version, body)).map((c) => [c.heading, c]));

  const cited = await db
    .select({ card: t.cards, chunk: t.docChunks })
    .from(t.cards)
    .innerJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .where(and(eq(t.docChunks.docId, docId), lt(t.cards.docVersion, version)));

  const staleIds: string[] = [];
  let carriedOver = 0;
  for (const { card, chunk } of cited) {
    const next = fresh.get(chunk.heading);
    if (next && next.text === chunk.text) {
      await db.update(t.cards).set({ sourceChunkId: next.id, docVersion: version }).where(eq(t.cards.id, card.id));
      carriedOver++;
    } else if (card.status !== "rejected") {
      staleIds.push(card.id);
    }
  }
  if (staleIds.length) await db.update(t.cards).set({ status: "stale" }).where(inArray(t.cards.id, staleIds));

  const flagged = staleIds.length
    ? await db
        .update(t.corrections)
        .set({ needsReview: true })
        .where(
          inArray(
            t.corrections.gradeId,
            db
              .select({ id: t.grades.id })
              .from(t.grades)
              .innerJoin(t.attempts, eq(t.grades.attemptId, t.attempts.id))
              .where(inArray(t.attempts.cardId, staleIds)),
          ),
        )
        .returning()
    : [];

  return { docId, version, staleCards: staleIds.length, carriedOver, flaggedCorrections: flagged.length };
}

/**
 * Rewrites each stale card from the current version of its section, as a draft for review. The stale card is
 * retired. A section that no longer exists retires its cards without a replacement.
 */
export async function regenerateStale(db: DB, llm: LlmClient, docId: string) {
  const [doc] = await db.select().from(t.docs).where(eq(t.docs.id, docId));
  if (!doc) throw new NotFoundError(`Doc ${docId} not found`);
  const current = new Map(
    (await db.select().from(t.docChunks).where(and(eq(t.docChunks.docId, docId), eq(t.docChunks.docVersion, doc.version)))).map((c) => [c.heading, c]),
  );
  const stale = await db
    .select({ card: t.cards, chunk: t.docChunks, gym: t.gyms, pack: t.packs })
    .from(t.cards)
    .innerJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .innerJoin(t.gyms, eq(t.cards.gymId, t.gyms.id))
    .innerJoin(t.packs, eq(t.gyms.packId, t.packs.id))
    .where(and(eq(t.docChunks.docId, docId), eq(t.cards.status, "stale")));

  const created = [];
  for (const { card, chunk, pack } of stale) {
    const section = current.get(chunk.heading);
    if (section) {
      created.push(
        await createCardFromChunk(db, llm, { chunkId: section.id, gymId: card.gymId, type: card.type, role: pack.role ?? "Everyone", isBoss: card.isBoss }),
      );
    }
    await db.update(t.cards).set({ status: "rejected" }).where(eq(t.cards.id, card.id));
  }
  return { regenerated: created.length, retired: stale.length, cards: created };
}

export interface UploadPackInput {
  companyId: string;
  title: string;
  role: string | null;
  markdown: string;
  gymName?: string;
  leaderName?: string;
  /** Publish straight away (live demo), or leave the cards as drafts and the gym locked until reviewed. */
  publish: boolean;
}

const PACK_CARD_TYPES: t.CardType[] = ["free_text", "mcq", "free_text", "mcq", "free_text", "mcq"];

/**
 * A new content pack becomes a playable gym: the doc is chunked, one card is generated per section (up to six,
 * alternating judgement and fact questions), the last free-text card is the boss, and the gym moves into the
 * annex. Generation runs three at a time.
 */
export async function uploadPack(db: DB, llm: LlmClient, input: UploadPackInput) {
  const [company] = await db.select().from(t.companies).where(eq(t.companies.id, input.companyId));
  if (!company) throw new NotFoundError("Company not found");
  const occupied = await db
    .select({ id: t.gyms.id })
    .from(t.gyms)
    .innerJoin(t.packs, eq(t.gyms.packId, t.packs.id))
    .where(and(eq(t.packs.companyId, company.id), eq(t.gyms.building, ANNEX)));
  if (occupied.length) throw new BadRequestError("The annex already has a gym. Reset the demo to upload another pack.");

  const sections = chunkMarkdown(input.markdown);
  if (sections.length < 2) throw new BadRequestError("The document needs at least two sections (## headings) to make a gym.");

  const slug = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pack";
  const [pack] = await db.insert(t.packs).values({ companyId: company.id, slug, type: "role", role: input.role, title: input.title }).returning();
  const [doc] = await db.insert(t.docs).values({ packId: pack.id, slug, title: markdownTitle(input.markdown, input.title), body: input.markdown }).returning();
  const chunks = (await insertChunks(db, doc.id, doc.version, input.markdown)).slice(0, PACK_CARD_TYPES.length);
  const [gym] = await db
    .insert(t.gyms)
    .values({ packId: pack.id, name: input.gymName ?? `${input.title} Gym`, leaderName: input.leaderName ?? "Leader Nova", building: ANNEX, order: 99, locked: !input.publish })
    .returning();

  const lastFreeText = chunks.map((_, i) => PACK_CARD_TYPES[i]).lastIndexOf("free_text");
  const status: t.CardStatus = input.publish ? "approved" : "draft";
  const cards: (typeof t.cards.$inferSelect)[] = new Array(chunks.length);
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const i = next++;
      cards[i] = await createCardFromChunk(db, llm, {
        chunkId: chunks[i].id,
        gymId: gym.id,
        type: PACK_CARD_TYPES[i],
        role: input.role ?? "Everyone",
        isBoss: i === lastFreeText,
        status,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
  return { pack, gym, cards };
}
