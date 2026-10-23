import { readFileSync } from "node:fs";
import path from "node:path";
import { defaultLevels, type PackSpec, type WorldSpec } from "../../content/acme-pay/world";
import { chunkMarkdown, markdownTitle } from "../lib/chunk";
import type { DB } from "./client";
import * as t from "./schema";

/** Deletes every row, children first, so the seed can run again on the same database. */
export async function resetDb(db: DB): Promise<void> {
  await db.delete(t.corrections);
  await db.delete(t.grades);
  await db.delete(t.attempts);
  await db.delete(t.weaknesses);
  await db.delete(t.cardReviews);
  await db.delete(t.cards);
  await db.delete(t.gyms);
  await db.delete(t.docChunks);
  await db.delete(t.docs);
  await db.delete(t.packs);
  await db.delete(t.learners);
  await db.delete(t.modelVersions);
  await db.delete(t.companies);
}

/** Inserts one content pack: its docs (chunked), its gym and its cards with resolved citations. */
export async function seedPack(db: DB, companyId: string, pack: PackSpec, contentDir: string): Promise<string> {
  const [packRow] = await db
    .insert(t.packs)
    .values({ companyId, slug: pack.slug, type: pack.type, role: pack.role, title: pack.title })
    .returning();

  // doc slug -> heading -> chunk
  const chunkIndex = new Map<string, Map<string, { id: string; text: string; docVersion: number }>>();
  for (const doc of pack.docs) {
    const body = readFileSync(path.join(contentDir, doc.file), "utf8");
    const [docRow] = await db
      .insert(t.docs)
      .values({ packId: packRow.id, slug: doc.slug, title: markdownTitle(body, doc.slug), body })
      .returning();
    const byHeading = new Map<string, { id: string; text: string; docVersion: number }>();
    for (const chunk of chunkMarkdown(body)) {
      const [chunkRow] = await db
        .insert(t.docChunks)
        .values({ docId: docRow.id, docVersion: docRow.version, ord: chunk.ord, heading: chunk.heading, text: chunk.text })
        .returning();
      byHeading.set(chunk.heading, { id: chunkRow.id, text: chunk.text, docVersion: docRow.version });
    }
    chunkIndex.set(doc.slug, byHeading);
  }

  const [gymRow] = await db
    .insert(t.gyms)
    .values({ packId: packRow.id, ...pack.gym, locked: pack.gym.locked ?? false })
    .returning();

  for (const card of pack.cards) {
    const chunk = chunkIndex.get(card.source.doc)?.get(card.source.heading);
    if (!chunk) throw new Error(`Card cites missing section ${card.source.doc} > ${card.source.heading}`);
    const rubric: t.Rubric | null =
      card.type === "free_text" || card.type === "incident"
        ? { competency: card.competency, policy: chunk.text, levels: card.rubric?.levels ?? defaultLevels, signals: card.rubric?.signals, redFlags: card.rubric?.redFlags }
        : null;
    await db.insert(t.cards).values({
      gymId: gymRow.id,
      type: card.type,
      competency: card.competency,
      prompt: card.prompt,
      choices: card.choices ?? null,
      answerIdx: card.answerIdx ?? null,
      rubric,
      expertAnswer: card.expertAnswer ?? null,
      sourceChunkId: chunk.id,
      docVersion: chunk.docVersion,
      status: "approved",
      isBoss: card.isBoss ?? false,
    });
  }
  return packRow.id;
}

export interface SeedResult {
  companyId: string;
  learnerId: string;
}

/** Seeds a whole world: company, packs, a demo learner and the v0 grader version. */
export async function seedWorld(db: DB, world: WorldSpec, contentDir: string, v0Model: string): Promise<SeedResult> {
  const [company] = await db.insert(t.companies).values(world.company).returning();
  for (const pack of world.packs) await seedPack(db, company.id, pack, contentDir);
  const [learner] = await db.insert(t.learners).values({ companyId: company.id, name: "Sam", role: "Customer Support" }).returning();
  await db.insert(t.modelVersions).values({ task: "grade", label: "v0", model: v0Model, status: "promoted" });
  return { companyId: company.id, learnerId: learner.id };
}
