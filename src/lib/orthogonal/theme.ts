import type { Brand, Level, Step } from "./types";

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** True for colours that need dark text on top (cream, sun yellow, white). Non-hex colours count as dark. */
export function isLight(hex: string): boolean {
  const c = rgb(hex);
  return c ? (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6 : false;
}

export function withAlpha(hex: string, alpha: number): string {
  const c = rgb(hex);
  return c ? `rgba(${c[0]},${c[1]},${c[2]},${alpha})` : hex;
}

/** Outline and progress-track tints for text colour `fg`. */
export function tints(fg: string) {
  const light = isLight(fg);
  return { line: withAlpha(fg, light ? 0.25 : 0.2), track: withAlpha(fg, light ? 0.18 : 0.12) };
}

/** Recolours a step, picking readable text colours from the brand for the new background and accent. */
export function retheme(step: Step, brand: Brand, bg: string, accent: string): Step {
  const on = (c: string) => (isLight(c) ? brand.ink : brand.paper);
  return { ...step, theme: { bg, fg: on(bg), accent, onAccent: on(accent) } };
}

/** Picking a background equal to the accent would hide it, so the accent moves to a contrasting brand colour. */
export function rethemeBackground(step: Step, brand: Brand, bg: string): Step {
  const accent = step.theme.accent === bg ? (isLight(bg) ? brand.ink : brand.accent) : step.theme.accent;
  return retheme(step, brand, bg, accent);
}

/** XP earned when viewing step `cur`: everything before it, plus the final step's own reward once reached. */
export function xpAt(steps: Step[], cur: number): number {
  const before = steps.slice(0, cur).reduce((sum, s) => sum + s.xp, 0);
  return before + (steps[cur]?.kind === "done" ? steps[cur].xp : 0);
}

/** Highest level whose threshold the learner has reached. Levels are sorted by `at`. */
export function levelFor(levels: Level[], xp: number, total: number): Level {
  const share = total > 0 ? xp / total : 0;
  return levels.filter((l) => share >= l.at).at(-1) ?? levels[0];
}

export const levelLabel = (l: Level) => `Lvl ${l.level} · ${l.name}`;
