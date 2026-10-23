import { describe, expect, it, vi } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { approveGrade, createCorrection, retrieveCorrections } from "@/services/corrections";
import { DistilSink, MubitFeedbackSink } from "@/services/feedback";
import { submitAnswer } from "@/services/grading";
import { offlineGrade } from "@/tasks/offline-grade";
import { FakeLlm, cardByPrompt, seededDb } from "./helpers";

const HERO = "A merchant emails from their registered address";
const leniency = JSON.stringify({ scores: { "account-security": 2 }, evidence_quote: "update the payout account", feedback: "Mostly fine.", gap: "none" });

describe("corrections fast path", () => {
  it("retrieves a reviewer ruling into the next similar answer's grading prompt", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, HERO);
    const llm = new FakeLlm([leniency]);

    const first = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "It came from their registered email so I would update the payout account today." }, retrieveCorrections);
    expect(llm.requests[0].user).toContain("## Past reviewer rulings on similar answers\nNone.");

    const sink = new DistilSink();
    const { correction, feedback } = await createCorrection(db, llm, sink, {
      gradeId: first.grade!.id,
      correctedScores: { "account-security": 0 },
      reason: "We always call back on the number on file. Email is never enough.",
      reviewer: "Nicole",
    });
    expect(correction.sentToMubit).toBe(false);
    expect(feedback.detail).toContain("fast-path");

    await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "It's from the registered email address, so I'd update the payout account for them today." }, retrieveCorrections);
    const prompt = llm.requests[1].user;
    expect(prompt).toContain("Reviewer corrected to: {\"account-security\":0}");
    expect(prompt).toContain("We always call back on the number on file");

    const [grade] = await db.select().from(t.grades).orderBy(t.grades.createdAt);
    expect(grade.reviewed).toBe(true);
  });

  it("ignores unrelated answers and other competencies", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, HERO);
    const llm = new FakeLlm([leniency]);
    const first = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "It came from their registered email so I would update the payout account today." }, retrieveCorrections);
    await createCorrection(db, llm, new DistilSink(), { gradeId: first.grade!.id, correctedScores: { "account-security": 0 }, reason: "Callback required", reviewer: "Nicole" });

    expect(await retrieveCorrections(db, llm, "Totally different words about holidays and lunch", "account-security")).toHaveLength(0);
    expect(await retrieveCorrections(db, llm, "It came from their registered email so I would update the payout account today.", "refunds")).toHaveLength(0);
  });

  it("makes the offline grader apply the ruling on a paraphrase (offline demo of the fast path)", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, HERO);
    const llm = new OfflineClient({ grade: offlineGrade });
    const answer = "Since it came from their registered email, I would update the payout account and remind them about the 24-hour hold.";
    const before = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: answer }, retrieveCorrections);
    await createCorrection(db, llm, new DistilSink(), { gradeId: before.grade!.id, correctedScores: { "account-security": 0 }, reason: "Never change bank details from an email; call back on the number on file.", reviewer: "Nicole" });

    const after = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "Since it came from their registered email I'd update the payout account, and remind them of the 24-hour hold." }, retrieveCorrections);
    expect(after.grade!.scores["account-security"]).toBe(0);
    expect(after.grade!.retrievedCorrections).toBe(1);
  });

  it("validates corrections and records approvals", async () => {
    const { db, learnerId } = await seededDb();
    const card = await cardByPrompt(db, HERO);
    const llm = new FakeLlm([leniency]);
    const first = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: "I would update the payout account." }, retrieveCorrections);
    await expect(createCorrection(db, llm, new DistilSink(), { gradeId: first.grade!.id, correctedScores: { wrong: 1 }, reason: "x", reviewer: "N" })).rejects.toThrow(/cover exactly/);
    await expect(createCorrection(db, llm, new DistilSink(), { gradeId: first.grade!.id, correctedScores: { "account-security": 1 }, reason: " ", reviewer: "N" })).rejects.toThrow(/reason/);
    const approved = await approveGrade(db, new DistilSink(), first.grade!.id, "Nicole");
    expect(approved.gradeId).toBe(first.grade!.id);
  });
});

describe("MubitFeedbackSink", () => {
  it("posts the verdict with the Mubit request id and bearer key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const sink = new MubitFeedbackSink(
      { apiKey: "key", baseURL: "https://api.example/openai/v1", taskHeader: "X", embedModel: null, pricePerMInput: 0, pricePerMOutput: 0 },
      "/feedback",
      fetchImpl,
    );
    const res = await sink.send({ kind: "correction", task: "grade", requestId: "req-1", scenario: "s", answer: "a", original: { c: 2 }, corrected: { c: 0 }, reason: "r", reviewer: "N" });
    expect(res.delivered).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example/openai/v1/feedback");
    expect(init.headers.authorization).toBe("Bearer key");
    expect(JSON.parse(init.body)).toMatchObject({ request_id: "req-1", verdict: "correct", corrected_output: { scores: { c: 0 } } });
  });
});
