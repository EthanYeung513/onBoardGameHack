// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningTimeline } from "@/components/admin/LearningTimeline";
import { recordVersion } from "@/eval/gate";
import { OfflineClient } from "@/llm/offline";
import { createCorrection, retrieveCorrections } from "@/services/corrections";
import { DistilSink } from "@/services/feedback";
import { submitAnswer } from "@/services/grading";
import { getTimeline, type Timeline } from "@/services/timeline";
import { offlineGrade } from "@/tasks/offline-grade";
import { cardByPrompt, seededDb } from "./helpers";

const metrics = (agreement: number, cost: number) => ({ n: 12, failed: 0, agreement, withinOne: 0.9, mae: 0.4, costPer1k: cost, p50Ms: 400, p95Ms: 900 });

describe("getTimeline", () => {
  it("counts grades, verdicts, corrections and fast-path grades, and lists versions", async () => {
    const { db, learnerId } = await seededDb();
    const llm = new OfflineClient({ grade: offlineGrade });
    const card = await cardByPrompt(db, "A merchant emails from their registered address");
    const answer = "Since it came from their registered email, I'd update the payout account today.";
    const first = await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: answer }, retrieveCorrections);
    await createCorrection(db, llm, new DistilSink(), { gradeId: first.grade!.id, correctedScores: { "account-security": 0 }, reason: "Callback first", reviewer: "Nicole" });
    await submitAnswer(db, llm, { learnerId, cardId: card.id, answerText: answer }, retrieveCorrections);
    await recordVersion(db, "grade", "v0", "frontier", metrics(0.6, 2));
    await recordVersion(db, "grade", "v1", "adapter", metrics(0.8, 0.4));

    const tl = await getTimeline(db);
    expect(tl.counts).toMatchObject({ grades: 2, reviewed: 1, corrections: 1, approvals: 0, fastPathGrades: 1, sentToMubit: 0 });
    expect(tl.corrections[0]).toMatchObject({ reviewer: "Nicole", to: 0, competency: "account-security" });
    expect(tl.liveGrades[0].retrievedCorrections).toBe(1);
    expect(tl.versions.map((v) => [v.label, v.status])).toEqual([
      ["v0", "candidate"],
      ["v1", "promoted"],
    ]);
  });
});

describe("LearningTimeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the pipeline, headline tiles against the baseline, and gate status as text", async () => {
    const timeline: Timeline & { mode: string; feedbackSink: string } = {
      mode: "mubit",
      feedbackSink: "distil",
      counts: { grades: 30, reviewed: 12, corrections: 9, approvals: 3, sentToMubit: 0, fastPathGrades: 4 },
      trainingThreshold: 25,
      versions: [
        { label: "v0", model: "frontier", status: "candidate", heldOutAgreement: 0.6, withinOne: 0.9, mae: 0.5, costPer1k: 2, p50Ms: 900, trainedAt: null },
        { label: "v1", model: "adapter-1", status: "promoted", heldOutAgreement: 0.85, withinOne: 1, mae: 0.15, costPer1k: 0.4, p50Ms: 300, trainedAt: null },
        { label: "v2", model: "adapter-2", status: "blocked", heldOutAgreement: 0.7, withinOne: 0.95, mae: 0.3, costPer1k: 0.4, p50Ms: 300, trainedAt: null },
      ],
      corrections: [{ id: "c1", createdAt: "", reviewer: "Nicole", reason: "Callback first", competency: "account-security", from: 2, to: 0, sentToMubit: false }],
      liveGrades: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(timeline))));
    render(<LearningTimeline pollMs={0} />);

    expect(await screen.findByText("25/25")).toBeInTheDocument();
    expect(screen.getByText("85.0%", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("v0: 60.0%")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(within(rows[3]).getByText(/Blocked by gate/)).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Promoted/)).toBeInTheDocument();
    expect(screen.getByText("Callback first")).toBeInTheDocument();
  });

  it("explains how to measure versions when none exist", async () => {
    const empty = { mode: "offline", feedbackSink: "distil", counts: { grades: 0, reviewed: 0, corrections: 0, approvals: 0, sentToMubit: 0, fastPathGrades: 0 }, trainingThreshold: 25, versions: [], corrections: [], liveGrades: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(empty))));
    render(<LearningTimeline pollMs={0} />);
    expect(await screen.findByText(/No versions measured yet/)).toBeInTheDocument();
  });
});
