import manifest from "./ace-attorney.json";
import type { Mood } from "./spec";

/**
 * Ace Attorney sprites, backgrounds and shout graphics, listed in ace-attorney.json and bundled with the
 * hire-facing world in world/public/games/ace-attorney/. The base is relative, so the files resolve next to
 * the world's index.html wherever it is served (including under `<base href="/world/">`).
 */
export const ASSET_BASE = "games/ace-attorney";

/** Must match `assetFile` in scripts/fetch-ace-attorney.mjs. */
export const assetFile = (title: string) =>
  title.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+(\.\w+)$/, "$1").replace(/^-+/, "");
const url = (title: string) => `${ASSET_BASE}/${assetFile(title)}`;

/** [idle] or [idle, talking]. */
type Frames = string[];
interface CharacterPack {
  name: string;
  aspect: string;
  moods: Partial<Record<Mood, Frames>>;
  poses?: Partial<Record<"point" | "objecting" | "deskSlam", Frames>>;
}

const characters = manifest.characters as Record<string, CharacterPack>;

export const CHARACTER_IDS = ["phoenix", "maya", "redd-white", "dee-vasquez", "wendy-oldbag", "judge"] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export const characterName = (id: CharacterId) => characters[id].name;

/**
 * The sprite for a character in a mood: the talking animation while they speak, the idle one otherwise.
 * Missing moods fall back to neutral; a pose (e.g. pointing) overrides the mood.
 */
export function spriteFor(id: CharacterId, mood: Mood, talking: boolean, pose?: "point" | "objecting" | "deskSlam"): string {
  const pack = characters[id];
  const frames = (pose && pack.poses?.[pose]) || pack.moods[mood] || pack.moods.neutral!;
  return url(talking && frames[1] ? frames[1] : frames[0]);
}

export type View = "defense" | "witness" | "office" | "reception";

export const backgroundFor = (view: View) => url(manifest.backgrounds[view]);

export const SHOUTS = {
  objection: url(manifest.shouts.objection),
  holdIt: url(manifest.shouts.holdIt),
  takeThat: url(manifest.shouts.takeThat),
};

/** Where a non-player character stands for each scene setting. */
export function viewForSetting(setting: string): View {
  if (setting === "office") return "office";
  if (setting === "reception") return "reception";
  return "witness";
}

/** Every file a game will show, so it can be preloaded before play. */
export function preloadList(ids: CharacterId[]): string[] {
  const files = new Set<string>([...Object.values(manifest.backgrounds), ...Object.values(manifest.shouts)].map(url));
  for (const id of ids) {
    const pack = characters[id];
    for (const frames of [...Object.values(pack.moods), ...Object.values(pack.poses ?? {})]) frames?.forEach((f) => files.add(url(f)));
  }
  return [...files];
}

/** Every wiki file title in the manifest (for the asset check in tests). */
export const allAssetTitles = (): string[] => [
  ...Object.values(manifest.backgrounds),
  ...Object.values(manifest.shouts),
  ...Object.values(characters).flatMap((c) => [...Object.values(c.moods), ...Object.values(c.poses ?? {})].flat() as string[]),
];
