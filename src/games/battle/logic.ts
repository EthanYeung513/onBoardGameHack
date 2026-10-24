import type { GameMistake } from "../core/types";
import { seededRandom, seedFrom, shuffle } from "../core/random";
import type { BattleSpec } from "./spec";

/** Answering correctly within this time is a critical hit. */
export const CRIT_WINDOW_MS = 6000;
export const MAX_HP = 100;
export const POINTS = { correct: 100, crit: 50 };

export interface BattleState {
  /** Rounds still to answer, by index. A missed round goes back to the end. */
  queue: number[];
  current: number;
  /** Per round: the order choices are shown in (display index -> original index). */
  order: number[][];
  playerHp: number;
  foeHp: number;
  attempts: number;
  correct: number;
  score: number;
  mistakes: GameMistake[];
  status: "playing" | "won" | "lost";
}

export interface Outcome {
  correct: boolean;
  crit: boolean;
  damage: number;
  chosen: string;
  expected: string;
}

/** Damage per correct answer: enough that answering every round once knocks the foe out. */
export const foeHit = (rounds: number) => Math.ceil(MAX_HP / rounds);
export const playerHit = (lives: number) => Math.ceil(MAX_HP / lives);

export function createBattle(spec: BattleSpec, seed = seedFrom(spec.title)): BattleState {
  const rng = seededRandom(seed);
  const order = spec.rounds.map((r) => shuffle(r.choices.map((_, i) => i), rng));
  const [current, ...queue] = spec.rounds.map((_, i) => i);
  return { queue, current, order, playerHp: MAX_HP, foeHp: MAX_HP, attempts: 0, correct: 0, score: 0, mistakes: [], status: "playing" };
}

/** The current round's choices in display order. */
export function displayedChoices(state: BattleState, spec: BattleSpec): string[] {
  const round = spec.rounds[state.current];
  return state.order[state.current].map((i) => round.choices[i]);
}

/** Applies one answer. The state moves to the next round (or ends); the outcome drives the animations. */
export function answer(state: BattleState, spec: BattleSpec, displayIndex: number, elapsedMs: number): { state: BattleState; outcome: Outcome } {
  if (state.status !== "playing") throw new Error("The battle is over");
  const round = spec.rounds[state.current];
  const picked = state.order[state.current][displayIndex];
  if (picked === undefined) throw new Error(`No choice at position ${displayIndex}`);
  const correct = picked === round.answer;
  const crit = correct && elapsedMs <= CRIT_WINDOW_MS;
  const damage = correct ? Math.round(foeHit(spec.rounds.length) * (crit ? 1.5 : 1)) : playerHit(spec.lives);
  const outcome: Outcome = { correct, crit, damage, chosen: round.choices[picked], expected: round.choices[round.answer] };

  const next: BattleState = { ...state, attempts: state.attempts + 1 };
  let queue = state.queue;
  if (correct) {
    next.foeHp = Math.max(0, state.foeHp - damage);
    next.correct = state.correct + 1;
    next.score = state.score + POINTS.correct + (crit ? POINTS.crit : 0);
  } else {
    next.playerHp = Math.max(0, state.playerHp - damage);
    next.mistakes = [
      ...state.mistakes,
      { itemId: round.id, prompt: round.prompt, chosen: outcome.chosen, expected: outcome.expected, explanation: round.explanation, source: round.source },
    ];
    queue = [...queue, state.current];
  }

  if (next.foeHp <= 0) next.status = "won";
  else if (next.playerHp <= 0) next.status = "lost";
  else if (queue.length === 0) next.status = "won";
  else [next.current, ...next.queue] = queue;
  if (next.status !== "playing") next.queue = [];
  return { state: next, outcome };
}

export const maxScore = (spec: BattleSpec) => spec.rounds.length * (POINTS.correct + POINTS.crit);
