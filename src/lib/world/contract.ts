import type { GameId } from "@/games/core/types";

// The hire-facing onboarding world's data contract (D-35). The manager's Generate turns the space's
// courses, brain facts, brand and rewards into one `world.json` (src/lib/world/build.ts, pure
// templating, no model call); the prebuilt Stardew-style world (world/, served from /world/) reads
// it at start: one building per course, entering a building plays that course's game.
// Types only: imported by the Next app, the worker and the Vite world build.

export const WORLD_VERSION = 1;

export interface WorldCourse {
  /** Stable per space (the course's packType), used for saves and progress. */
  id: string;
  name: string;
  desc?: string;
  /** Building sprite key for the world (worldgen BUILDINGS); omitted → the world cycles buildings. */
  building?: string;
  /** Credits paid on completion. */
  reward?: number;
  /** The game played inside this building, and its spec (valid for that game's Zod schema). */
  game: GameId;
  spec: unknown;
  /** Number of steps in the course that are stale because brain facts changed (shown as a badge). */
  staleSteps?: number;
}

export interface WorldNpc {
  name: string;
  role: string;
  /** Short facts this person shares when the hire talks to them. */
  facts: string[];
}

export interface WorldData {
  version: typeof WORLD_VERSION;
  company: { name: string; host: string; logoUrl: string | null };
  brand: { primary: string; accent: string; surface: string; text: string; headingFont: string; bodyFont: string };
  courses: WorldCourse[];
  npcs: WorldNpc[];
  /** Company facts for town signs, NPC chatter and loading tips. */
  facts: string[];
  rewards: { id: string; name: string; cost: number }[];
  /** True when content came from offline stand-ins (no model configured); the world shows a label. */
  offline: boolean;
  /** When this world's content was generated (ISO). The world shows "updated …". */
  generatedAt: string;
}
