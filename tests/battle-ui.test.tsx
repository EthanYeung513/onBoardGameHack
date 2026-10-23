// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Battle } from "@/components/play/Battle";
import type { SubmitResult } from "@/services/grading";
import type { PublicCard } from "@/services/world";

const freeText: PublicCard = {
  id: "c1",
  type: "free_text",
  competency: "account-security",
  prompt: "A merchant emails asking to change bank details today. What do you do?",
  choices: null,
  isBoss: false,
};
const mcq: PublicCard = { id: "c2", type: "mcq", competency: "refunds", prompt: "Refund over £250?", choices: ["Approve", "Team lead"], isBoss: false };

const graded: SubmitResult = {
  attemptId: "a1",
  correct: true,
  competency: "account-security",
  expertAnswer: "Call back on the number on file.",
  correctChoice: null,
  citation: { docTitle: "Support playbook", heading: "Bank detail changes", text: "Callback required.", docVersion: 1 },
  grade: {
    id: "g1",
    scores: { "account-security": 3 },
    evidenceQuote: "call them back",
    feedback: "Spot on.",
    gap: "none",
    modelVersion: "v0",
    model: "offline-baseline",
    latencyMs: 5,
    costUsd: 0,
    retrievedCorrections: 0,
    mode: "offline",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("Battle", () => {
  it("grades a free-text answer, shows the evidence and citation, and wins", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(graded)));
    vi.stubGlobal("fetch", fetchMock);
    const onFinish = vi.fn();
    const user = userEvent.setup();
    render(<Battle title="Support Gym" foeName="Trainer" foeKind="support" cards={[freeText]} learnerId="l1" onFinish={onFinish} />);

    await user.type(screen.getByLabelText("Your answer"), "I would call them back on the number on file.");
    await user.click(screen.getByRole("button", { name: "Attack!" }));

    expect(await screen.findByTestId("grade-display")).toBeInTheDocument();
    expect(screen.getByText("call them back").tagName).toBe("MARK");
    expect(screen.getByText(/Critical hit!/)).toBeInTheDocument();
    expect(screen.getByText(/Support playbook › Bank detail changes/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/grade");
    expect(JSON.parse(init.body as string)).toMatchObject({ learnerId: "l1", cardId: "c1", answerText: "I would call them back on the number on file." });

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Trainer fainted!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onFinish).toHaveBeenCalledWith(true);
  });

  it("hits the player on a wrong multiple-choice answer and shows the right one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...graded, correct: false, grade: null, correctChoice: "Team lead" }))));
    const user = userEvent.setup();
    render(<Battle title="Support Gym" foeName="Trainer" foeKind="support" cards={[mcq]} learnerId="l1" onFinish={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("You took 34 damage.")).toBeInTheDocument();
    expect(screen.getByText("Team lead")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "You HP" })).toHaveAttribute("aria-valuenow", "66");
  });
});
