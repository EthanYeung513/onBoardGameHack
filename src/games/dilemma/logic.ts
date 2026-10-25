import type { GameMistake } from "../core/types";
import { seededRandom, seedFrom, shuffle } from "../core/random";
import type { DilemmaOption, DilemmaSpec, Look } from "./spec";

export const POINTS = { best: 100, acceptable: 50, wrong: 0 } as const;

export interface DilemmaState {
  /** The scene being played. */
  scene: number;
  /** Per scene: the order options are shown in (display index -> original index). */
  order: number[][];
  credibility: number;
  score: number;
  correct: number;
  answered: number;
  mistakes: GameMistake[];
  status: "playing" | "won" | "lost";
}

export function createDilemma(spec: DilemmaSpec, seed = seedFrom(spec.title)): DilemmaState {
  const rng = seededRandom(seed);
  return {
    scene: 0,
    order: spec.scenes.map((s) => shuffle(s.options.map((_, i) => i), rng)),
    credibility: spec.credibility,
    score: 0,
    correct: 0,
    answered: 0,
    mistakes: [],
    status: "playing",
  };
}

export const displayedOptions = (state: DilemmaState, spec: DilemmaSpec): DilemmaOption[] =>
  state.order[state.scene].map((i) => spec.scenes[state.scene].options[i]);

export const maxScore = (spec: DilemmaSpec) => spec.scenes.length * POINTS.best;

/** Strips the *emphasis* markers for plain-text contexts like the results screen. */
export const plain = (text: string) => text.replace(/\*/g, "");

/**
 * Answers the current scene. The state moves to the next scene (or ends); the chosen option drives the reaction.
 * A wrong answer costs one credibility; running out loses the game.
 */
export function choose(state: DilemmaState, spec: DilemmaSpec, displayIndex: number): { state: DilemmaState; option: DilemmaOption } {
  if (state.status !== "playing") throw new Error("The game is over");
  const scene = spec.scenes[state.scene];
  const option = scene.options[state.order[state.scene][displayIndex]];
  if (!option) throw new Error(`No option at position ${displayIndex}`);

  const next: DilemmaState = { ...state, answered: state.answered + 1, score: state.score + POINTS[option.verdict] };
  if (option.verdict === "best") next.correct = state.correct + 1;
  else {
    const best = scene.options.find((o) => o.verdict === "best")!;
    next.mistakes = [
      ...state.mistakes,
      { itemId: scene.id, prompt: plain(scene.question.text), chosen: option.text, expected: best.text, explanation: option.feedback, source: option.source ?? best.source },
    ];
  }
  if (option.verdict === "wrong") next.credibility = state.credibility - 1;

  if (next.credibility <= 0) next.status = "lost";
  else if (state.scene === spec.scenes.length - 1) next.status = "won";
  else next.scene = state.scene + 1;
  return { state: next, option };
}

export interface RichSegment {
  text: string;
  emphasis: boolean;
}

/** Splits `*emphasis*` markup into segments. */
export function parseRich(text: string): RichSegment[] {
  return text
    .split(/(\*[^*]+\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("*") && part.endsWith("*") && part.length > 2 ? { text: part.slice(1, -1), emphasis: true } : { text: part, emphasis: false }));
}

/** The first `count` visible characters of rich text, keeping emphasis (for the typewriter). */
export function sliceRich(segments: RichSegment[], count: number): RichSegment[] {
  const out: RichSegment[] = [];
  let left = count;
  for (const seg of segments) {
    if (left <= 0) break;
    out.push({ ...seg, text: seg.text.slice(0, left) });
    left -= seg.text.length;
  }
  return out;
}

export const visibleLength = (segments: RichSegment[]) => segments.reduce((n, s) => n + s.text.length, 0);

/** Lines in parentheses are the player's thoughts. */
export const isThought = (text: string) => /^\(.*\)$/s.test(text.trim());

const SKINS = ["#f2c9a0", "#e0ac7e", "#c68a5e", "#8d5a3b", "#f7d7b8"];
const HAIRS = ["#2b1a12", "#101018", "#c76b2a", "#e3c35b", "#6b3e26", "#9aa0a8"];
const OUTFITS = ["#2a4bd1", "#3d3d46", "#7a1f3d", "#1f5e3a", "#5b3fc4", "#8a5a1f"];
const ACCENTS = ["#e8e8f0", "#d63c3c", "#ffd166", "#79c143", "#f2d2a9", "#4cc9f0"];
const STYLES = ["short", "spiky", "long", "bob", "bun", "short"] as const;

/** A complete look: anything the spec leaves out is generated from the character's id, so it stays stable. */
export function resolveLook(id: string, look: Look = {}): Required<Look> {
  const rng = seededRandom(seedFrom(id));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rng() * list.length)];
  return {
    skin: look.skin ?? pick(SKINS),
    hair: look.hair ?? pick(HAIRS),
    hairStyle: look.hairStyle ?? pick(STYLES),
    outfit: look.outfit ?? pick(OUTFITS),
    accent: look.accent ?? pick(ACCENTS),
    glasses: look.glasses ?? rng() < 0.25,
  };
}
