import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { buildGradeUserMessage, GradeError, gradeAnswer, validateGrade, type GradeInput } from "@/tasks/grade";
import { offlineGrade } from "@/tasks/offline-grade";
import { submitAnswer } from "@/services/grading";
import { retrieveCorrections } from "@/services/corrections";
import { FakeLlm, cardByPrompt, seededDb } from "./helpers";

const rubric: t.Rubric = {
  competency: "account-security",
  policy: "Bank details only change after a callback to the phone number on file.",
  levels: { "0": "breaks policy", "1": "weak", "2": "ok", "3": "full" },
  signals: [["call back", "callback"], ["fraud"]],
  redFlags: ["update the details"],
};
const input: GradeInput = {
  packTitle: "Customer Support",
  role: "Customer Support",
  scenario: "Merchant emails asking to change bank details today.",
  rubric,
  answer: "I would call back the merchant on the number on file and flag possible fraud.",
  corrections: [],
};
const good = JSON.stringify({ scores: { "account-security": 3 }, evidence_quote: "call back the merchant", feedback: "Nice.", gap: "none" });

describe("validateGrade", () => {
  it("accepts a well-formed grade with an exact quote", () => {
    expect(validateGrade(good, input).ok).toBe(true);
  });
  it("rejects non-JSON, out-of-range scores, missing competencies and invented quotes", () => {
    expect(validateGrade("not json", input)).toMatchObject({ ok: false });
    expect(validateGrade(JSON.stringify({ scores: { "account-security": 5 }, evidence_quote: "call back", feedback: "x", gap: "y" }), input)).toMatchObject({ ok: false });
    expect(validateGrade(JSON.stringify({ scores: { other: 2 }, evidence_quote: "call back", feedback: "x", gap: "y" }), input)).toMatchObject({ ok: false });
    expect(validateGrade(JSON.stringify({ scores: { "account-security": 2 }, evidence_quote: "I refused politely", feedback: "x", gap: "y" }), input)).toMatchObject({
      ok: false,
      error: expect.stringContaining("evidence_quote"),
    });
  });
});

describe("gradeAnswer", () => {
  it("retries once with the validation error, then succeeds", async () => {
    const llm = new FakeLlm(["oops", good]);
    const { grade, call } = await gradeAnswer(llm, "m", input);
    expect(grade.scores["account-security"]).toBe(3);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[1].user).toContain("previous reply was rejected");
    expect(llm.requests[1].system).toBe(llm.requests[0].system);
    expect(call.latencyMs).toBe(200);
  });
  it("rejects after a second invalid reply", async () => {
    await expect(gradeAnswer(new FakeLlm(["oops", "still bad"]), "m", input)).rejects.toBeInstanceOf(GradeError);
  });
  it("puts rulings and policy in the user message", () => {
    const msg = buildGradeUserMessage({
      ...input,
      corrections: [{ id: "c1", answer: "I'd update it", originalScores: { "account-security": 2 }, correctedScores: { "account-security": 0 }, reason: "Never from email", similarity: 0.9 }],
    });
    expect(msg).toContain("Reviewer corrected to");
    expect(msg).toContain("Never from email");
    expect(msg).toContain(rubric.policy);
  });
});

describe("offlineGrade", () => {
  it("scores by rubric signals and docks a point for a red flag", () => {
    expect(offlineGrade(input).scores["account-security"]).toBe(3);
    const risky = offlineGrade({ ...input, answer: "I'd update the details and call back later." });
    expect(risky.scores["account-security"]).toBe(1);
    expect("I'd update the details and call back later.").toContain(risky.evidence_quote);
  });
  it("follows a very similar reviewer ruling", () => {
    const out = offlineGrade({
      ...input,
      corrections: [{ id: "c1", answer: input.answer, originalScores: { "account-security": 3 }, correctedScores: { "account-security": 1 }, reason: "Also needs the app 2FA step", similarity: 0.95 }],
    });
    expect(out.scores["account-security"]).toBe(1);
  });
});

describe("submitAnswer", () => {
  it("checks multiple choice against the answer key without calling the grader", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, "A merchant asks for a £400 refund");
    const llm = new FakeLlm([good]);
    const right = await submitAnswer(db, llm, { learnerId, cardId: card.id, choiceIdx: card.answerIdx! }, retrieveCorrections);
    const wrong = await submitAnswer(db, llm, { learnerId, cardId: card.id, choiceIdx: 0 }, retrieveCorrections);
    expect(right.correct).toBe(true);
    expect(wrong.correct).toBe(false);
    expect(wrong.citation?.heading).toBe("Refunds");
    expect(llm.requests).toHaveLength(0);
  });

  it("grades free text, persists the grade and returns the citation", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, "A merchant emails from their registered address");
    const answer = "I'd call them back on the number on file and get them to approve it in the app with 2FA.";
    const result = await submitAnswer(db, new OfflineClient({ grade: offlineGrade }), { learnerId, cardId: card.id, answerText: answer }, retrieveCorrections);
    expect(result.grade?.scores["account-security"]).toBeGreaterThanOrEqual(1);
    expect(answer.toLowerCase()).toContain(result.grade!.evidenceQuote.toLowerCase());
    expect(result.citation?.heading).toBe("Bank detail changes");
    const grades = await db.select().from(t.grades);
    expect(grades).toHaveLength(1);
    expect(grades[0].modelVersion).toBe("v0");
  });
});
