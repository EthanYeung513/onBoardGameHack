import path from "node:path";
import { describe, expect, it } from "vitest";
import { acmePay } from "../content/acme-pay/world";
import { connectPglite } from "@/db/client";
import { resetDb, seedWorld } from "@/db/seed";
import * as t from "@/db/schema";
import { chunkMarkdown } from "@/lib/chunk";

const contentDir = path.join(process.cwd(), "content", "acme-pay");

describe("chunkMarkdown", () => {
  it("splits on ## headings and drops the # title", () => {
    const chunks = chunkMarkdown("# Title\n\nIntro text\n\n## One\nA\n\n## Two\nB");
    expect(chunks.map((c) => c.heading)).toEqual(["Introduction", "One", "Two"]);
    expect(chunks[1].text).toBe("A");
  });
});

describe("seedWorld", () => {
  it("populates every content table and resolves every citation", async () => {
    const db = await connectPglite({ memory: true });
    await seedWorld(db, acmePay, contentDir, "offline-baseline");

    const cardCount = acmePay.packs.reduce((n, p) => n + p.cards.length, 0);
    expect(await db.select().from(t.companies)).toHaveLength(1);
    expect(await db.select().from(t.packs)).toHaveLength(acmePay.packs.length);
    expect(await db.select().from(t.gyms)).toHaveLength(acmePay.packs.length);
    const cards = await db.select().from(t.cards);
    expect(cards).toHaveLength(cardCount);
    expect(cards.every((c) => c.sourceChunkId)).toBe(true);
    expect(cards.filter((c) => c.type === "free_text").every((c) => c.rubric?.policy)).toBe(true);
    expect((await db.select().from(t.docChunks)).length).toBeGreaterThan(10);
    expect(await db.select().from(t.learners)).toHaveLength(1);
    expect(await db.select().from(t.modelVersions)).toHaveLength(1);

    await resetDb(db);
    await seedWorld(db, acmePay, contentDir, "offline-baseline");
    expect(await db.select().from(t.cards)).toHaveLength(cardCount);
  });
});
