import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { retrieveCorrections } from "@/services/corrections";
import { resetAllowed, resetDemo } from "@/services/demo";
import { submitAnswer } from "@/services/grading";
import { offlineGrade } from "@/tasks/offline-grade";
import { cardByPrompt, seededDb } from "./helpers";

describe("demo reset", () => {
  it("restores the seeded state after play", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, "A merchant emails from their registered address");
    await submitAnswer(db, new OfflineClient({ grade: offlineGrade }), { learnerId, cardId: card.id, answerText: "I'd call back." }, retrieveCorrections);
    const cardsBefore = (await db.select().from(t.cards)).length;

    await resetDemo(db);
    expect(await db.select().from(t.grades)).toHaveLength(0);
    expect(await db.select().from(t.attempts)).toHaveLength(0);
    expect(await db.select().from(t.learners)).toHaveLength(1);
    expect(await db.select().from(t.cards)).toHaveLength(cardsBefore);
    expect((await db.select().from(t.modelVersions)).map((v) => v.label)).toEqual(["v0"]);
  });

  it("is open in development and key-protected elsewhere", () => {
    expect(resetAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv, null)).toBe(true);
    expect(resetAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv, null)).toBe(false);
    expect(resetAllowed({ NODE_ENV: "production", DEMO_RESET_KEY: "s3cret" } as NodeJS.ProcessEnv, "s3cret")).toBe(true);
    expect(resetAllowed({ NODE_ENV: "development", DEMO_RESET_KEY: "s3cret" } as NodeJS.ProcessEnv, "wrong")).toBe(false);
  });
});
