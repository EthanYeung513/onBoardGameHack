import { asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import type { GameId } from "@/games/core/types";
import type { LlmClient } from "@/llm/types";
import { generateGameSpec } from "@/tasks/generate-game";
import { modelFor } from "./cards";
import { BadRequestError, NotFoundError } from "./errors";

/** Keep the prompt bounded: newest sections first is arbitrary, so take the pack's first chunks in order. */
const MAX_SECTIONS = 14;
const MAX_SECTION_CHARS = 2500;

export interface GameForPack {
  game: GameId;
  spec: unknown;
  packId: string;
  packTitle: string;
  sectionsUsed: number;
  requestId: string | null;
}

/** The company a course belongs to — used for page branding (title, extracted-logo favicon). */
export async function companyForPack(
  db: DB,
  packId: string,
): Promise<{ id: string; name: string; slug: string } | null> {
  const [row] = await db
    .select({ id: t.companies.id, name: t.companies.name, slug: t.companies.slug })
    .from(t.packs)
    .innerJoin(t.companies, eq(t.packs.companyId, t.companies.id))
    .where(eq(t.packs.id, packId));
  return row ?? null;
}

/**
 * Turns a course (a content pack: its docs and their current sections) into a playable game.
 * The spec is regenerated on every call, so editing the course's docs changes the game's dialogue.
 */
export async function generateGameForPack(
  db: DB,
  llm: LlmClient,
  input: { packId: string; game?: GameId; playerName?: string },
): Promise<GameForPack> {
  const [pack] = await db.select().from(t.packs).where(eq(t.packs.id, input.packId));
  if (!pack) throw new NotFoundError(`Course ${input.packId} not found`);

  const docs = await db.select().from(t.docs).where(eq(t.docs.packId, pack.id));
  if (!docs.length) throw new BadRequestError(`Course "${pack.title}" has no documents yet`);

  const chunks = await db
    .select({ heading: t.docChunks.heading, text: t.docChunks.text, docId: t.docChunks.docId, ord: t.docChunks.ord })
    .from(t.docChunks)
    .where(inArray(t.docChunks.docId, docs.map((d) => d.id)))
    .orderBy(asc(t.docChunks.docId), asc(t.docChunks.ord))
    .limit(MAX_SECTIONS);
  if (!chunks.length) throw new BadRequestError(`Course "${pack.title}" has no content sections yet`);

  const docTitle = new Map(docs.map((d) => [d.id, d.title]));
  const { game, spec, call } = await generateGameSpec(llm, await modelFor(db, "generate-game"), {
    packTitle: pack.title,
    role: pack.role,
    game: input.game,
    playerName: input.playerName,
    sections: chunks.map((c) => ({
      doc: docTitle.get(c.docId) ?? "Course document",
      heading: c.heading,
      text: c.text.slice(0, MAX_SECTION_CHARS),
    })),
  });
  return { game, spec, packId: pack.id, packTitle: pack.title, sectionsUsed: chunks.length, requestId: call.requestId };
}
