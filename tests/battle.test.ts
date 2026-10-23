import { describe, expect, it } from "vitest";
import { applyTurn, nextTurn, startBattle, type BattleState, type TurnOutcome } from "@/game/battle";

function play(cards: number, outcomes: TurnOutcome[]): BattleState {
  let s = startBattle(cards);
  for (const o of outcomes) {
    s = nextTurn(applyTurn(s, o));
    if (s.phase === "won" || s.phase === "lost") break;
  }
  return s;
}

describe("battle", () => {
  it("is won by answering every card correctly", () => {
    expect(play(3, [{ correct: true }, { correct: true }, { correct: true }]).phase).toBe("won");
  });

  it("crits on a full-marks free-text answer and can finish early", () => {
    const s = applyTurn(startBattle(4), { correct: true, score: 3 });
    expect(s.lastHit).toEqual({ target: "foe", amount: 38, crit: true });
    expect(play(4, [{ correct: true, score: 3 }, { correct: true, score: 3 }, { correct: true, score: 3 }]).phase).toBe("won");
  });

  it("is lost after three misses or when cards run out with the foe standing", () => {
    expect(play(5, [{ correct: false }, { correct: false }, { correct: false }]).phase).toBe("lost");
    expect(play(2, [{ correct: true }, { correct: false }]).phase).toBe("lost");
  });

  it("ignores input outside the right phase", () => {
    const s = applyTurn(startBattle(2), { correct: true });
    expect(applyTurn(s, { correct: true })).toBe(s);
    expect(nextTurn(startBattle(2)).phase).toBe("question");
    expect(startBattle(0).phase).toBe("won");
  });
});
