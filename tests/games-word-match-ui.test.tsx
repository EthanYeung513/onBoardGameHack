// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GameResult } from "@/games/core/types";
import { WordMatchGame } from "@/games/word-match/WordMatchGame";
import { wordMatchSample as spec } from "@/games/word-match/spec";

const card = (text: string) => screen.getByRole("button", { name: text });
const pair = (i: number) => {
  fireEvent.click(card(spec.pairs[i].term));
  fireEvent.click(card(spec.pairs[i].meaning));
};

describe("WordMatchGame", () => {
  it("matches pairs with a combo, clears every board and reports a win", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    render(<WordMatchGame spec={spec} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /START/ }));

    pair(0);
    expect(card(spec.pairs[0].term)).toBeDisabled();
    pair(1);
    expect(screen.getByLabelText("Score 300")).toBeInTheDocument();
    expect(screen.getByLabelText("Combo 2")).toBeInTheDocument();
    // The ticker repeats the last pair learned.
    expect(screen.getByTestId("word-match").querySelector("[aria-live=polite]")).toHaveTextContent(`${spec.pairs[1].term}: ${spec.pairs[1].meaning}`);

    for (let i = 2; i < spec.pairs.length; i++) pair(i);
    expect(screen.getByText("YOU WIN!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SEE RESULTS" }));
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ gameId: "word-match", won: true, correct: spec.pairs.length, mistakes: [] }));
  });

  it("a wrong pair costs a heart and losing every life ends the game", () => {
    const onComplete = vi.fn<(r: GameResult) => void>();
    render(<WordMatchGame spec={{ ...spec, lives: 2 }} instant onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /START/ }));

    fireEvent.click(card(spec.pairs[0].term));
    fireEvent.click(card(spec.pairs[1].meaning));
    expect(screen.getByLabelText("1 of 2 lives left")).toBeInTheDocument();
    fireEvent.click(card(spec.pairs[2].term));
    fireEvent.click(card(spec.pairs[3].meaning));
    expect(screen.getByText("GAME OVER")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SEE RESULTS" }));
    const result = onComplete.mock.calls[0][0];
    expect(result.won).toBe(false);
    expect(result.mistakes.map((m) => m.prompt)).toEqual([spec.pairs[0].term, spec.pairs[2].term]);
  });
});
