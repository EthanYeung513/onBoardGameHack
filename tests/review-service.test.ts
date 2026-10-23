import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { createCorrection, retrieveCorrections } from "@/services/corrections";
import { DistilSink } from "@/services/feedback";
import { submitAnswer } from "@/services/grading";
import { getReviewQueue, reviewCard } from "@/services/review";
import { offlineGrade } from "@/tasks/offline-grade";
import { cardByPrompt, seededDb } from "./helpers";

describe("review queue service", () => {
  it("lists unreviewed grades and drops them once corrected (creating a Correction row)", async () => {
    const { db, learnerId } = await seededDb();
    const llm = new OfflineClient({ grade: offlineGrade });
    const card = await cardByPrompt(db, "A merchant emails from their registered address");
    const result = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "I'd update the details today." }, retrieveCorrections);

    const before = await getReviewQueue(db);
    expect(before.grades.map((g) => g.gradeId)).toEqual([result.grade!.id]);
    expect(before.grades[0].learnerName).toBe("Sam");

    await createCorrection(db, llm, new DistilSink(), { gradeId: result.grade!.id, correctedScores: { "account-security": 0 }, reason: "Callback first", reviewer: "Nicole" });
    expect((await getReviewQueue(db)).grades).toHaveLength(0);
    expect(await db.select().from(t.corrections)).toHaveLength(1);
  });

  it("approves, edits and rejects draft cards, recording each review", async () => {
    const { db } = await seededDb();
    const [card] = await db.select().from(t.cards).limit(1);
    await db.update(t.cards).set({ status: "draft" }).where(eq(t.cards.id, card.id));
    expect((await getReviewQueue(db)).cards).toHaveLength(1);

    const edited = await reviewCard(db, card.id, "edit", "Nicole", { prompt: "Edited prompt" });
    expect(edited.prompt).toBe("Edited prompt");
    expect(edited.status).toBe("approved");
    await reviewCard(db, card.id, "reject", "Nicole");
    const reviews = await db.select().from(t.cardReviews);
    expect(reviews.map((r) => r.action)).toEqual(["edit", "reject"]);
    await expect(reviewCard(db, card.id, "edit", "Nicole", {})).rejects.toThrow(/changed field/);
  });
});
