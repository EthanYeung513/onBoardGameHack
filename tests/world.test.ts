import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { getBossDeck } from "@/services/adaptive";
import { submitAnswer } from "@/services/grading";
import { retrieveCorrections } from "@/services/corrections";
import { awardBadge, getEncounterCard, getTrainerDeck, getWorld, joinCompany } from "@/services/world";
import { FakeLlm, seededDb } from "./helpers";

describe("world service", () => {
  it("joins by company code and lists gyms with the annex locked", async () => {
    const { db } = await seededDb();
    await expect(joinCompany(db, { joinCode: "NOPE", name: "A", role: "Sales" })).rejects.toThrow(/Unknown company code/);
    const { learner } = await joinCompany(db, { joinCode: "acme", name: "Ada", role: "Engineering" });

    const world = await getWorld(db, learner.id);
    expect(world.gyms.map((g) => g.building)).toEqual(["townhall", "security", "support", "engineering"]);
    expect(world.locked).toEqual(["annex"]);
    expect(world.gyms.find((g) => g.building === "support")?.forYou).toBe(false);
    expect(world.gyms.find((g) => g.building === "engineering")?.forYou).toBe(true);
    expect(world.gyms.find((g) => g.building === "security")?.forYou).toBe(true);
  });

  it("serves decks without answer keys and keeps phishing emails for encounters", async () => {
    const { db, learnerId } = await seededDb();
    const [security] = await db.select().from(t.gyms).where(eq(t.gyms.building, "security"));
    const trainers = await getTrainerDeck(db, security.id);
    expect(trainers.length).toBeGreaterThan(0);
    expect(trainers.every((c) => c.type !== "phish_email" && !c.isBoss)).toBe(true);
    for (const card of trainers) {
      expect(card).not.toHaveProperty("answerIdx");
      expect(card).not.toHaveProperty("expertAnswer");
      expect(card).not.toHaveProperty("rubric");
    }
    expect((await getBossDeck(db, learnerId, security.id)).length).toBeGreaterThan(0);
    expect((await getEncounterCard(db, learnerId, () => 0)).type).toBe("phish_email");
  });

  it("awards a badge only after a correct answer in that gym, once", async () => {
    const { db, learnerId } = await seededDb();
    const [support] = await db.select().from(t.gyms).where(eq(t.gyms.building, "support"));
    await expect(awardBadge(db, learnerId, support.id)).rejects.toThrow(/Beat the gym/);

    const [mcq] = (await db.select().from(t.cards).where(eq(t.cards.gymId, support.id))).filter((c) => c.type === "mcq");
    await submitAnswer(db, new FakeLlm(["{}"]), { learnerId, cardId: mcq.id, choiceIdx: mcq.answerIdx! }, retrieveCorrections);
    await awardBadge(db, learnerId, support.id);
    await awardBadge(db, learnerId, support.id);
    expect(await db.select().from(t.badges)).toHaveLength(1);
    expect((await getWorld(db, learnerId)).gyms.find((g) => g.id === support.id)?.cleared).toBe(true);
  });
});
