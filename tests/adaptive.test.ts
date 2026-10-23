import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { getBossDeck, getWeaknesses, recordOutcome } from "@/services/adaptive";
import { createCorrection, retrieveCorrections } from "@/services/corrections";
import { DistilSink } from "@/services/feedback";
import { submitAnswer } from "@/services/grading";
import { FakeLlm, seededDb } from "./helpers";

async function gym(db: Awaited<ReturnType<typeof seededDb>>["db"], building: string) {
  const [row] = await db.select().from(t.gyms).where(eq(t.gyms.building, building));
  const cards = await db.select().from(t.cards).where(eq(t.cards.gymId, row.id));
  return { gym: row, cards };
}

describe("weakness tracking", () => {
  it("counts attempts and fails per competency, and lets a correction move a fail", async () => {
    const { db, learnerId } = await seededDb();
    await recordOutcome(db, learnerId, "refunds", { attempts: 1, fails: 1 });
    await recordOutcome(db, learnerId, "refunds", { attempts: 1, fails: 0 });
    await recordOutcome(db, learnerId, "complaints", { attempts: 1, fails: 0 });
    expect(await getWeaknesses(db, learnerId)).toEqual([{ competency: "refunds", attempts: 2, fails: 1, failRate: 0.5 }]);

    await recordOutcome(db, learnerId, "refunds", { attempts: 0, fails: -5 });
    expect(await getWeaknesses(db, learnerId)).toEqual([]);
  });

  it("is updated by answers and by reviewer corrections", async () => {
    const { db, learnerId } = await seededDb();
    const { cards } = await gym(db, "support");
    const hero = cards.find((c) => c.competency === "account-security" && c.type === "free_text")!;
    const lenient = JSON.stringify({ scores: { "account-security": 2 }, evidence_quote: "update the payout account", feedback: "ok", gap: "none" });
    const res = await submitAnswer(db, new FakeLlm([lenient]), { learnerId, cardId: hero.id, answerText: "I would update the payout account." }, retrieveCorrections);
    expect(await getWeaknesses(db, learnerId)).toEqual([]);

    await createCorrection(db, new FakeLlm([lenient]), new DistilSink(), { gradeId: res.grade!.id, correctedScores: { "account-security": 0 }, reason: "Callback first", reviewer: "N" });
    expect((await getWeaknesses(db, learnerId)).map((w) => w.competency)).toEqual(["account-security"]);
  });
});

describe("boss deck", () => {
  it("is the gym's boss cards (plus fill) when the learner has no weaknesses", async () => {
    const { db, learnerId } = await seededDb();
    const { gym: support } = await gym(db, "support");
    const deck = await getBossDeck(db, learnerId, support.id);
    expect(deck).toHaveLength(4);
    expect(deck.filter((c) => c.isBoss)).toHaveLength(2);
    expect(deck.every((c) => c.type !== "phish_email")).toBe(true);
  });

  it("is at least 60% the learner's weak competencies", async () => {
    const { db, learnerId } = await seededDb();
    const { gym: support } = await gym(db, "support");
    await recordOutcome(db, learnerId, "account-security", { attempts: 2, fails: 2 });
    await recordOutcome(db, learnerId, "refunds", { attempts: 2, fails: 1 });

    const deck = await getBossDeck(db, learnerId, support.id);
    const weak = deck.filter((c) => ["account-security", "refunds"].includes(c.competency));
    expect(weak.length / deck.length).toBeGreaterThanOrEqual(0.6);
  });

  it("puts a different scenario for the same competency ahead of the one just failed", async () => {
    const { db, learnerId } = await seededDb();
    const { gym: support, cards } = await gym(db, "support");
    const mcq = cards.find((c) => c.competency === "account-security" && c.type === "mcq")!;
    const freeText = cards.find((c) => c.competency === "account-security" && c.type === "free_text")!;
    await submitAnswer(db, new FakeLlm(["{}"]), { learnerId, cardId: mcq.id, choiceIdx: 0 }, retrieveCorrections);

    const deck = await getBossDeck(db, learnerId, support.id, 1);
    expect(deck.map((c) => c.id)).toEqual([freeText.id]);
  });
});
