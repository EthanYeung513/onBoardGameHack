import { describe, expect, it } from "vitest";
import { instantiateGame } from "@/games/core/instantiate";
import { createWordMatch, maxScore, nextBoard, select, timeUp, type WordMatchState } from "@/games/word-match/logic";
import { wordMatchSample as spec, wordMatchSpecSchema } from "@/games/word-match/spec";

const matchAll = (s: WordMatchState) => {
  for (const p of s.boards[s.board]) {
    s = select(s, spec, "term", p).state;
    s = select(s, spec, "meaning", p).state;
  }
  return s;
};

describe("word match spec", () => {
  it("validates the sample, fills defaults and is instantiable", () => {
    const parsed = wordMatchSpecSchema.parse({ title: "T", pairs: spec.pairs.slice(0, 4) });
    expect(parsed).toMatchObject({ boardSize: 4, timeLimitSec: 60, lives: 5 });
    expect(instantiateGame({ game: "word-match", spec }).ok).toBe(true);
  });

  it("rejects duplicate terms or meanings and too few pairs", () => {
    const pairs = spec.pairs.slice(0, 4);
    expect(wordMatchSpecSchema.safeParse({ title: "T", pairs: [...pairs.slice(0, 3), { ...pairs[3], term: pairs[0].term }] }).success).toBe(false);
    expect(wordMatchSpecSchema.safeParse({ title: "T", pairs: [...pairs.slice(0, 3), { ...pairs[3], meaning: pairs[0].meaning }] }).success).toBe(false);
    expect(wordMatchSpecSchema.safeParse({ title: "T", pairs: pairs.slice(0, 3) }).success).toBe(false);
  });
});

describe("word match logic", () => {
  it("splits pairs into boards and shuffles each column", () => {
    const s = createWordMatch(spec, 3);
    expect(s.boards).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]]);
    expect([...s.terms].sort()).toEqual([0, 1, 2, 3]);
    expect([...s.meanings].sort()).toEqual([0, 1, 2, 3]);
  });

  it("folds a lone leftover pair into the previous board", () => {
    const s = createWordMatch({ ...spec, pairs: spec.pairs.slice(0, 5), boardSize: 4 }, 1);
    expect(s.boards).toEqual([[0, 1, 2, 3, 4]]);
  });

  it("selects, swaps within a column, and deselects", () => {
    let s = createWordMatch(spec, 1);
    s = select(s, spec, "term", 0).state;
    expect(s.selected).toEqual({ side: "term", pair: 0 });
    s = select(s, spec, "term", 1).state;
    expect(s.selected).toEqual({ side: "term", pair: 1 });
    expect(select(s, spec, "term", 1).state.selected).toBeNull();
  });

  it("scores matches with a growing combo multiplier, capped", () => {
    let s = createWordMatch(spec, 1);
    const points: number[] = [];
    for (const p of [0, 1, 2]) {
      s = select(s, spec, "meaning", p).state;
      const r = select(s, spec, "term", p);
      s = r.state;
      if (r.event.type === "match") points.push(r.event.points);
    }
    expect(points).toEqual([100, 200, 300]);
    expect(s.bestCombo).toBe(3);
    expect(maxScore({ ...spec, pairs: spec.pairs.slice(0, 7) })).toBe(100 + 200 + 300 + 400 + 500 + 500 + 500);
  });

  it("a miss costs a life, breaks the combo and records the right meaning", () => {
    let s = createWordMatch(spec, 1);
    s = select(s, spec, "term", 0).state;
    s = select(s, spec, "meaning", 0).state;
    s = select(s, spec, "term", 1).state;
    const r = select(s, spec, "meaning", 2);
    expect(r.event).toEqual({ type: "miss", term: 1, meaning: 2 });
    expect(r.state).toMatchObject({ lives: spec.lives - 1, combo: 0, boardMisses: 1 });
    expect(r.state.mistakes[0]).toMatchObject({ prompt: spec.pairs[1].term, chosen: spec.pairs[2].meaning, expected: spec.pairs[1].meaning });
  });

  it("clears boards in turn and wins on the last", () => {
    let s = createWordMatch(spec, 1);
    s = matchAll(s);
    expect(s.status).toBe("boardClear");
    s = nextBoard(s, spec);
    expect(s).toMatchObject({ board: 1, matched: [], status: "playing" });
    s = matchAll(nextBoard(matchAll(s), spec));
    expect(s.status).toBe("won");
    expect(s.score).toBe(maxScore(spec));
  });

  it("is lost when lives run out, and time up counts unmatched pairs as mistakes", () => {
    let s = createWordMatch({ ...spec, lives: 1 }, 1);
    s = select(s, spec, "term", 0).state;
    expect(select(s, spec, "meaning", 1).state.status).toBe("lost");

    let t = createWordMatch(spec, 1);
    t = select(t, spec, "term", 0).state;
    t = select(t, spec, "meaning", 0).state;
    t = timeUp(t, spec);
    expect(t.status).toBe("timeUp");
    expect(t.mistakes.map((m) => m.itemId)).toEqual([spec.pairs[1].id, spec.pairs[2].id, spec.pairs[3].id]);
  });
});
