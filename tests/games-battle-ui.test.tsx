// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BattleGame } from "@/games/battle/BattleGame";
import { battleSample as spec } from "@/games/battle/spec";
import type { GameResult } from "@/games/core/types";

/** Clicks through text until the move menu (or the end) appears. */
function advanceToMenu() {
  for (let i = 0; i < 20; i++) {
    if (screen.queryAllByRole("button").some((b) => b.className.includes("move") && !b.hasAttribute("disabled"))) return;
    const results = screen.queryByRole("button", { name: /See results/ });
    if (results) return;
    fireEvent.click(screen.getByRole("button", { name: /Tap to continue/ }));
  }
}

const moveButtons = () => screen.getAllByRole("button").filter((b) => b.className.includes("move"));
const currentRound = () => spec.rounds.find((r) => screen.getByTestId("textbox").textContent?.includes(r.prompt))!;

describe("BattleGame", () => {
  it("plays intro text, then a correct move hits and a full run wins with results", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    render(<BattleGame spec={spec} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /Start battle/ }));
    expect(screen.getByTestId("textbox")).toHaveTextContent(`A wild ${spec.opponent.name} appeared!`);

    for (let i = 0; i < spec.rounds.length; i++) {
      advanceToMenu();
      if (screen.queryByRole("button", { name: /See results/ })) break;
      const round = currentRound();
      fireEvent.click(moveButtons().find((b) => b.textContent?.startsWith(round.choices[round.answer]))!);
      expect(screen.getByTestId("textbox")).toHaveTextContent(`used ${round.choices[round.answer].toUpperCase()}!`);
    }
    advanceToMenu();
    expect(screen.getByLabelText(`${spec.opponent.name} HP 0 of 100`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /See results/ }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ gameId: "battle", won: true, mistakes: [] }));
  });

  it("a wrong move gets the player hit, explains the answer, and three misses black out", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    render(<BattleGame spec={spec} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /Start battle/ }));
    for (let i = 0; i < spec.lives; i++) {
      advanceToMenu();
      const round = currentRound();
      fireEvent.click(moveButtons().find((b) => !b.textContent?.startsWith(round.choices[round.answer]))!);
      // "used X!" -> "attack missed!" -> "foe used Y!" -> the explanation.
      for (let step = 0; step < 3; step++) fireEvent.click(screen.getByRole("button", { name: /Tap to continue/ }));
      expect(screen.getByTestId("textbox")).toHaveTextContent(`The right move was "${round.choices[round.answer]}"`);
    }
    advanceToMenu();
    expect(screen.getAllByText(/blacked out!/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(`0 of ${spec.lives} lives left`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /See results/ }));
    const result = onComplete.mock.calls[0][0];
    expect(result).toMatchObject({ won: false, correct: 0, total: spec.lives });
    expect(result.mistakes).toHaveLength(spec.lives);
  });
});
