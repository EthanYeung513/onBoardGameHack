// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameResult } from "@/games/core/types";
import { DilemmaGame } from "@/games/dilemma/DilemmaGame";
import { dilemmaSample as spec, type DilemmaSpec } from "@/games/dilemma/spec";

const stage = () => screen.getByTestId("dilemma");
/** Clicks the stage until the choices (or the verdict) show. */
function toChoices() {
  for (let i = 0; i < 30; i++) {
    if (screen.queryByText("WHAT WILL YOU SAY?") || screen.queryByRole("button", { name: "See results" })) return;
    fireEvent.click(stage());
  }
}

describe("DilemmaGame", () => {
  it("plays a scene: dialogue, choices, OBJECTION! on the best answer, then the rule as a thought", () => {
    render(<DilemmaGame spec={spec} instant />);
    fireEvent.click(screen.getByRole("button", { name: "▶ BEGIN" }));
    expect(screen.getByText("The Urgent Call")).toBeInTheDocument();
    fireEvent.click(stage());
    expect(screen.getByTestId("textbox")).toHaveTextContent("Wendy from IT here");
    expect(screen.getByText("suspicious logins")).toHaveClass(/emphasis/);

    toChoices();
    const best = spec.scenes[0].options.find((o) => o.verdict === "best")!;
    fireEvent.click(screen.getByRole("button", { name: best.text }));
    expect(screen.getByRole("img", { name: "OBJECTION!" })).toBeInTheDocument();
    fireEvent.click(stage());
    expect(screen.getByTestId("textbox")).toHaveTextContent(best.response[0].text.replace(/\*/g, ""));
    fireEvent.click(stage());
    expect(screen.getByTestId("textbox")).toHaveTextContent(`(That's right! ${best.feedback})`);
  });

  it("shows HOLD IT! for an acceptable answer and costs trust for a wrong one", () => {
    render(<DilemmaGame spec={spec} instant />);
    fireEvent.click(screen.getByRole("button", { name: "▶ BEGIN" }));
    toChoices();
    fireEvent.click(screen.getByRole("button", { name: spec.scenes[0].options.find((o) => o.verdict === "acceptable")!.text }));
    expect(screen.getByRole("img", { name: "HOLD IT!" })).toBeInTheDocument();
    expect(screen.getByLabelText(`Trust ${spec.credibility} of ${spec.credibility}`)).toBeInTheDocument();

    toChoices();
    fireEvent.click(screen.getByRole("button", { name: spec.scenes[1].options.find((o) => o.verdict === "wrong")!.text }));
    expect(screen.queryByRole("img", { name: /OBJECTION|HOLD IT/ })).toBeNull();
    expect(screen.getByLabelText(`Trust ${spec.credibility - 1} of ${spec.credibility}`)).toBeInTheDocument();
  });

  it("reaches the CLEARED! verdict and reports the result", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    render(<DilemmaGame spec={spec} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "▶ BEGIN" }));
    for (const scene of spec.scenes) {
      toChoices();
      fireEvent.click(screen.getByRole("button", { name: scene.options.find((o) => o.verdict === "best")!.text }));
    }
    toChoices();
    expect(screen.getByLabelText("CLEARED!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ gameId: "dilemma", won: true, score: 400, maxScore: 400, mistakes: [] }));
  });

  it("ends NOT READY when trust runs out", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    const harsh: DilemmaSpec = { ...spec, credibility: 2 };
    render(<DilemmaGame spec={harsh} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: "▶ BEGIN" }));
    for (const scene of harsh.scenes.slice(0, 2)) {
      toChoices();
      fireEvent.click(screen.getByRole("button", { name: scene.options.find((o) => o.verdict === "wrong")!.text }));
    }
    toChoices();
    expect(screen.getByLabelText("NOT READY")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See results" }));
    expect(onComplete.mock.calls[0][0]).toMatchObject({ won: false, correct: 0, total: 2 });
  });
});
