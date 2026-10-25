import type { ComponentType } from "react";
import { z } from "zod";

/**
 * The games an AI can pick. Each game lives in `src/games/<id>/` with a server-safe `spec.ts` (schema, sample,
 * guidance) and a client component, and registers itself in `catalog.ts` and `components.tsx`.
 */
export type GameId = "battle" | "word-match" | "dilemma";

/** Where a fact comes from, so feedback can cite the onboarding doc. */
export const sourceRefSchema = z
  .object({
    doc: z.string().min(1).describe("Document title, e.g. 'Information Security Policy v4.0'"),
    section: z.string().optional().describe("Section heading or number, e.g. '4. Phishing'"),
  })
  .describe("The onboarding document and section this item is based on");
export type SourceRef = z.infer<typeof sourceRefSchema>;

/** Fields every game spec shares. */
export const gameBaseSchema = z.object({
  title: z.string().min(1).max(80).describe("Short title shown at the start, e.g. 'Security basics'"),
  intro: z.string().max(300).optional().describe("One or two sentences setting the scene before play starts"),
});

export interface GameMistake {
  itemId: string;
  prompt: string;
  chosen: string;
  expected: string;
  explanation?: string;
  source?: SourceRef;
}

/** What every game reports when it ends, so results can be stored and compared across games. */
export interface GameResult {
  gameId: GameId;
  won: boolean;
  score: number;
  maxScore: number;
  correct: number;
  total: number;
  durationMs: number;
  mistakes: GameMistake[];
}

export interface GameProps<S> {
  spec: S;
  /** Called once when the game ends. */
  onComplete?: (result: GameResult) => void;
  /** Skip animations and typewriter effects (tests, reduced motion). */
  instant?: boolean;
  /** The shell's pause menu is open (or the hire left the building mid-run): timed text, clocks and
   * keyboard input hold still until it is false again, so Resume picks up exactly where play stopped. */
  paused?: boolean;
}

/** Everything the server (and the AI picker) needs to know about a game. No React, so it is safe anywhere. */
export interface GameSpecDefinition<S> {
  id: GameId;
  name: string;
  /** One line for people browsing the catalog. */
  description: string;
  /** Guidance for the AI choosing a game: what content and learning goal this game fits. */
  bestFor: string;
  /** Guidance for the AI writing the spec. */
  authoringTips: string[];
  schema: z.ZodType<S>;
  sample: S;
}

export type GameComponent<S> = ComponentType<GameProps<S>>;
