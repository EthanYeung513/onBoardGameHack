import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { getTrainerDeck, getWorld } from "@/services/world";
import { createCorrection, retrieveCorrections } from "@/services/corrections";
import { publishGym } from "@/services/content";
import { DistilSink } from "@/services/feedback";
import { submitAnswer } from "@/services/grading";
import { regenerateStale, updateDoc, uploadPack } from "@/services/refresh";
import { offlineGenerate } from "@/tasks/offline-generate";
import { offlineGrade } from "@/tasks/offline-grade";
import { cardByPrompt, seededDb } from "./helpers";

const llm = new OfflineClient({ grade: offlineGrade, generate: offlineGenerate });
const HERO = "A merchant emails from their registered address";

const WAREHOUSE = `# Warehouse handbook

## Cold chain
- Chilled stock stays between 0 and 5°C.
- Quarantine anything that arrives above 8°C.

## Forklifts
- Only certified staff drive forklifts.
- Pedestrians keep to the green walkways.

## Dispatch
- Terminals ship with tamper seals intact.
- Log every shipment's serial number before it leaves.`;

describe("policy edits", () => {
  it("marks cards citing a changed section stale, carries unchanged ones over, and flags old corrections", async () => {
    const { db, learnerId } = await seededDb();
    const hero = await cardByPrompt(db, HERO);
    const answer = "It's from their registered email so I'd update the payout account today.";
    const graded = await submitAnswer(db, llm, { learnerId, cardId: hero.id, answerText: answer }, retrieveCorrections);
    await createCorrection(db, llm, new DistilSink(), { gradeId: graded.grade!.id, correctedScores: { "account-security": 0 }, reason: "Callback first", reviewer: "N" });
    expect(await retrieveCorrections(db, llm, answer, "account-security")).toHaveLength(1);

    const [doc] = await db.select().from(t.docs).where(eq(t.docs.slug, "support-playbook"));
    const edited = doc.body.replace("Every change puts a 24-hour hold on payouts.", "Every change puts a 48-hour hold on payouts.");
    const result = await updateDoc(db, doc.id, edited);

    expect(result.version).toBe(2);
    expect(result.staleCards).toBe(1);
    expect(result.carriedOver).toBe(5);
    expect(result.flaggedCorrections).toBe(1);
    const [staleHero] = await db.select().from(t.cards).where(eq(t.cards.id, hero.id));
    expect(staleHero.status).toBe("stale");
    expect(await retrieveCorrections(db, llm, answer, "account-security")).toHaveLength(0);

    const [support] = await db.select().from(t.gyms).where(eq(t.gyms.building, "support"));
    expect((await getTrainerDeck(db, support.id)).some((c) => c.id === hero.id)).toBe(false);
    expect(await updateDoc(db, doc.id, edited)).toMatchObject({ version: 2, staleCards: 0 });
  });

  it("regenerates stale cards as drafts from the new wording and retires the old ones", async () => {
    const { db } = await seededDb();
    const hero = await cardByPrompt(db, HERO);
    const [doc] = await db.select().from(t.docs).where(eq(t.docs.slug, "support-playbook"));
    await updateDoc(db, doc.id, doc.body.replace("24-hour hold", "48-hour hold"));

    const { regenerated, retired, cards } = await regenerateStale(db, llm, doc.id);
    expect(regenerated).toBe(1);
    expect(retired).toBe(1);
    expect(cards[0]).toMatchObject({ status: "draft", docVersion: 2, type: "free_text" });
    expect(cards[0].rubric?.policy).toContain("48-hour hold");
    const [old] = await db.select().from(t.cards).where(eq(t.cards.id, hero.id));
    expect(old.status).toBe("rejected");
  });
});

describe("new content pack", () => {
  it("turns a new doc into a playable gym in the annex", async () => {
    const { db, companyId, learnerId } = await seededDb();
    expect((await getWorld(db, learnerId)).locked).toContain("annex");

    const { gym, cards } = await uploadPack(db, llm, { companyId, title: "Warehouse Ops", role: "Operations", markdown: WAREHOUSE, publish: true });
    expect(gym.building).toBe("annex");
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => c.status === "approved" && c.sourceChunkId)).toBe(true);
    expect(cards.filter((c) => c.isBoss)).toHaveLength(1);

    const world = await getWorld(db, learnerId);
    expect(world.locked).not.toContain("annex");
    expect(world.gyms.find((g) => g.building === "annex")?.name).toBe("Warehouse Ops Gym");

    await expect(uploadPack(db, llm, { companyId, title: "Again", role: null, markdown: WAREHOUSE, publish: true })).rejects.toThrow(/annex already/);
  });

  it("keeps the gym locked with draft cards until a manager publishes it", async () => {
    const { db, companyId, learnerId } = await seededDb();
    const { gym } = await uploadPack(db, llm, { companyId, title: "Warehouse Ops", role: "Operations", markdown: WAREHOUSE, publish: false });
    expect((await getWorld(db, learnerId)).locked).toContain("annex");
    expect(await getTrainerDeck(db, gym.id)).toHaveLength(0);

    const { approved } = await publishGym(db, gym.id, "Nicole");
    expect(approved).toBe(3);
    expect((await getWorld(db, learnerId)).locked).not.toContain("annex");
  });

  it("rejects a doc with fewer than two sections", async () => {
    const { db, companyId } = await seededDb();
    await expect(uploadPack(db, llm, { companyId, title: "Tiny", role: null, markdown: "# Tiny\n\n## Only\nOne section.", publish: true })).rejects.toThrow(/two sections/);
  });
});
