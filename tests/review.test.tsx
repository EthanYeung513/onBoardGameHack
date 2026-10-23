// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import type { QueueGrade } from "@/services/review";

const grade: QueueGrade = {
  gradeId: "g1",
  learnerName: "Sam",
  learnerRole: "Customer Support",
  cardPrompt: "A merchant emails asking to change bank details today.",
  competency: "account-security",
  answer: "It came from their registered email so I would update the payout account.",
  scores: { "account-security": 2 },
  evidenceQuote: "update the payout account",
  feedback: "Mostly fine.",
  gap: "none",
  modelVersion: "v0",
  retrievedCorrections: 0,
  levels: { "0": "Breaks policy", "1": "Weak", "2": "Mostly", "3": "Full" },
  createdAt: new Date().toISOString(),
};

function mockFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/review" && !init?.method) return new Response(JSON.stringify({ grades: [grade], cards: [] }));
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("ReviewQueue", () => {
  it("shows the AI grade with the evidence highlighted", async () => {
    mockFetch();
    render(<ReviewQueue pollMs={0} />);
    expect(await screen.findByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("update the payout account").tagName).toBe("MARK");
    expect(screen.getByText("2/3")).toBeInTheDocument();
  });

  it("posts a correction with the new score and reason", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<ReviewQueue pollMs={0} reviewer="Nicole" />);
    await user.click(await screen.findByRole("button", { name: "Override" }));
    await user.click(screen.getByText("0"));
    expect(screen.getByText("Breaks policy")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Reason"), "Always call back on the number on file");
    await user.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/corrections")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/corrections")!;
    expect(JSON.parse(init!.body as string)).toEqual({
      gradeId: "g1",
      correctedScores: { "account-security": 0 },
      reason: "Always call back on the number on file",
      reviewer: "Nicole",
    });
  });

  it("approves a grade", async () => {
    const fetchMock = mockFetch();
    const user = userEvent.setup();
    render(<ReviewQueue pollMs={0} />);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/grades/g1/approve")).toBe(true));
  });
});
