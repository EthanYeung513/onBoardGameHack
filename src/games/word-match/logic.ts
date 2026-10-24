import type { GameMistake } from "../core/types";
import { seededRandom, seedFrom, shuffle } from "../core/random";
import type { WordMatchSpec } from "./spec";

export const BASE_POINTS = 100;
export const MAX_MULTIPLIER = 5;

export type Side = "term" | "meaning";

export interface WordMatchState {
  /** Pair indexes per board, in spec order. */
  boards: number[][];
  board: number;
  /** Display order of each column on the current board (pair indexes). */
  terms: number[];
  meanings: number[];
  matched: number[];
  selected: { side: Side; pair: number } | null;
  lives: number;
  combo: number;
  bestCombo: number;
  score: number;
  attempts: number;
  correct: number;
  boardMisses: number;
  mistakes: GameMistake[];
  status: "playing" | "boardClear" | "won" | "lost" | "timeUp";
  seed: number;
}

export type SelectEvent =
  | { type: "selected" | "deselected" }
  | { type: "match"; pair: number; points: number; combo: number }
  | { type: "miss"; term: number; meaning: number };

const deal = (spec: WordMatchSpec, pairs: number[], seed: number) => {
  const rng = seededRandom(seed);
  return { terms: shuffle(pairs, rng), meanings: shuffle(pairs, rng) };
};

export function createWordMatch(spec: WordMatchSpec, seed = seedFrom(spec.title)): WordMatchState {
  const indexes = spec.pairs.map((_, i) => i);
  const boards: number[][] = [];
  for (let i = 0; i < indexes.length; i += spec.boardSize) boards.push(indexes.slice(i, i + spec.boardSize));
  // Fold a lone leftover pair into the previous board rather than showing a board of one.
  if (boards.length > 1 && boards[boards.length - 1].length < 2) boards[boards.length - 2].push(...boards.pop()!);
  return {
    boards,
    board: 0,
    ...deal(spec, boards[0], seed),
    matched: [],
    selected: null,
    lives: spec.lives,
    combo: 0,
    bestCombo: 0,
    score: 0,
    attempts: 0,
    correct: 0,
    boardMisses: 0,
    mistakes: [],
    status: "playing",
    seed,
  };
}

export const multiplier = (combo: number) => Math.min(combo, MAX_MULTIPLIER);

/** The best possible score: every match in one unbroken combo. */
export function maxScore(spec: WordMatchSpec): number {
  let total = 0;
  for (let k = 1; k <= spec.pairs.length; k++) total += BASE_POINTS * multiplier(k);
  return total;
}

/** Selecting a card. Two cards from different columns make an attempt. */
export function select(state: WordMatchState, spec: WordMatchSpec, side: Side, pair: number): { state: WordMatchState; event: SelectEvent } {
  if (state.status !== "playing" || state.matched.includes(pair) || !state.boards[state.board].includes(pair)) return { state, event: { type: "deselected" } };
  const sel = state.selected;
  if (!sel || sel.side === side) {
    if (sel && sel.pair === pair) return { state: { ...state, selected: null }, event: { type: "deselected" } };
    return { state: { ...state, selected: { side, pair } }, event: { type: "selected" } };
  }

  const term = side === "term" ? pair : sel.pair;
  const meaning = side === "meaning" ? pair : sel.pair;
  const next: WordMatchState = { ...state, selected: null, attempts: state.attempts + 1 };

  if (term === meaning) {
    const combo = state.combo + 1;
    const points = BASE_POINTS * multiplier(combo);
    next.combo = combo;
    next.bestCombo = Math.max(state.bestCombo, combo);
    next.score = state.score + points;
    next.correct = state.correct + 1;
    next.matched = [...state.matched, term];
    if (next.matched.length === state.boards[state.board].length) next.status = state.board === state.boards.length - 1 ? "won" : "boardClear";
    return { state: next, event: { type: "match", pair: term, points, combo } };
  }

  next.combo = 0;
  next.lives = state.lives - 1;
  next.boardMisses = state.boardMisses + 1;
  next.mistakes = [
    ...state.mistakes,
    { itemId: spec.pairs[term].id, prompt: spec.pairs[term].term, chosen: spec.pairs[meaning].meaning, expected: spec.pairs[term].meaning, source: spec.pairs[term].source },
  ];
  if (next.lives <= 0) next.status = "lost";
  return { state: next, event: { type: "miss", term, meaning } };
}

/** Deals the next board after a board is cleared. */
export function nextBoard(state: WordMatchState, spec: WordMatchSpec): WordMatchState {
  if (state.status !== "boardClear") return state;
  const board = state.board + 1;
  return { ...state, board, ...deal(spec, state.boards[board], state.seed + board), matched: [], selected: null, boardMisses: 0, status: "playing" };
}

/** The clock ran out: every unmatched pair on the board counts as a mistake and the game ends. */
export function timeUp(state: WordMatchState, spec: WordMatchSpec): WordMatchState {
  if (state.status !== "playing") return state;
  const missed = state.boards[state.board].filter((p) => !state.matched.includes(p));
  return {
    ...state,
    selected: null,
    status: "timeUp",
    mistakes: [...state.mistakes, ...missed.map((p) => ({ itemId: spec.pairs[p].id, prompt: spec.pairs[p].term, chosen: "(no match before time ran out)", expected: spec.pairs[p].meaning, source: spec.pairs[p].source }))],
  };
}
