import { describe, expect, it } from "vitest";
import { answer, createBattle, CRIT_WINDOW_MS, displayedChoices, foeHit, MAX_HP, maxScore } from "@/games/battle/logic";
import { battleSample, battleSpecSchema, type BattleSpec } from "@/games/battle/spec";
import { instantiateGame } from "@/games/core/instantiate";

const spec = battleSample;
const correctIndex = (s: ReturnType<typeof createBattle>) => s.order[s.current].indexOf(spec.rounds[s.current].answer);
const wrongIndex = (s: ReturnType<typeof createBattle>) => s.order[s.current].findIndex((i) => i !== spec.rounds[s.current].answer);
const SLOW = CRIT_WINDOW_MS + 1;

describe("battle spec", () => {
  it("validates the sample and fills defaults", () => {
    const parsed = battleSpecSchema.parse({ ...spec, player: undefined, lives: undefined });
    expect(parsed.player).toEqual({ name: "New Joiner", pokemon: 25, level: 30 });
    expect(parsed.lives).toBe(3);
  });

  it("defaults the arena to the meadow and rejects unknown arenas", () => {
    expect(battleSpecSchema.parse({ ...spec, arena: undefined }).arena).toBe("meadow");
    expect(battleSpecSchema.safeParse({ ...spec, arena: "moon" }).success).toBe(false);
  });

  it("rejects an answer index outside the choices, duplicate choices and too few rounds", () => {
    const round = { ...spec.rounds[0] };
    expect(battleSpecSchema.safeParse({ ...spec, rounds: [{ ...round, answer: 9 }, ...spec.rounds.slice(1)] }).success).toBe(false);
    expect(battleSpecSchema.safeParse({ ...spec, rounds: [{ ...round, choices: ["a", "a"] }, ...spec.rounds.slice(1)] }).success).toBe(false);
    expect(battleSpecSchema.safeParse({ ...spec, rounds: spec.rounds.slice(0, 2) }).success).toBe(false);
  });

  it("is registered and instantiable from AI output", () => {
    const result = instantiateGame({ game: "battle", spec });
    expect(result.ok).toBe(true);
  });
});

describe("battle logic", () => {
  it("shuffles choices but keeps the answer findable", () => {
    const s = createBattle(spec, 7);
    const shown = displayedChoices(s, spec);
    expect([...shown].sort()).toEqual([...spec.rounds[0].choices].sort());
    expect(shown[correctIndex(s)]).toBe(spec.rounds[0].choices[spec.rounds[0].answer]);
  });

  it("is won by answering every round correctly", () => {
    let s = createBattle(spec, 1);
    for (let i = 0; i < spec.rounds.length && s.status === "playing"; i++) s = answer(s, spec, correctIndex(s), SLOW).state;
    expect(s.status).toBe("won");
    expect(s.foeHp).toBe(0);
    expect(s.score).toBe(spec.rounds.length * 100);
    expect(s.mistakes).toEqual([]);
  });

  it("lands critical hits for fast answers and scores the bonus", () => {
    const s = createBattle(spec, 1);
    const { state, outcome } = answer(s, spec, correctIndex(s), 1000);
    expect(outcome).toMatchObject({ correct: true, crit: true, damage: Math.round(foeHit(spec.rounds.length) * 1.5) });
    expect(state.score).toBe(150);
    expect(maxScore(spec)).toBe(spec.rounds.length * 150);
  });

  it("sends a missed round to the back of the queue and records the mistake", () => {
    const s = createBattle(spec, 1);
    const first = s.current;
    const { state, outcome } = answer(s, spec, wrongIndex(s), SLOW);
    expect(outcome.correct).toBe(false);
    expect(state.playerHp).toBe(MAX_HP - Math.ceil(MAX_HP / spec.lives));
    expect(state.queue[state.queue.length - 1]).toBe(first);
    expect(state.mistakes[0]).toMatchObject({ itemId: spec.rounds[first].id, expected: spec.rounds[first].choices[spec.rounds[first].answer] });
  });

  it("is lost after `lives` wrong answers", () => {
    let s = createBattle(spec, 1);
    for (let i = 0; i < spec.lives; i++) s = answer(s, spec, wrongIndex(s), SLOW).state;
    expect(s.status).toBe("lost");
    expect(s.playerHp).toBe(0);
    expect(() => answer(s, spec, 0, 0)).toThrow(/over/);
  });

  it("stays winnable after mistakes because missed rounds come back", () => {
    const one: BattleSpec = { ...spec, lives: 3 };
    let s = createBattle(one, 2);
    s = answer(s, one, wrongIndex(s), SLOW).state;
    let guard = 0;
    while (s.status === "playing" && guard++ < 50) s = answer(s, one, correctIndex(s), SLOW).state;
    expect(s.status).toBe("won");
    expect(s.attempts).toBe(spec.rounds.length + 1);
  });
});
