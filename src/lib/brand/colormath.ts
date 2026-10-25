// Colour maths for brand candidates. Pure and dependency-free: Convex functions import it too.

const HEX6 = /^#[0-9a-f]{6}$/;

/** `#abc`, `#aabbcc`, `#aabbccdd`, `rgb(…)`/`rgba(…)` → `#rrggbb`, or null (incl. mostly transparent). */
export function toHex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  if (c.startsWith("#")) {
    const h = c.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) return `#${h.split("").map((x) => x + x).join("")}`;
    if (/^[0-9a-f]{6}$/.test(h)) return `#${h}`;
    if (/^[0-9a-f]{8}$/.test(h)) return parseInt(h.slice(6), 16) < 128 ? null : `#${h.slice(0, 6)}`;
    return null;
  }
  const m = c.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((n) => Number.isNaN(n))) return null;
  if (parts.length >= 4 && parts[3] < 0.5) return null;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export const isHex = (s: string) => HEX6.test(s);

export function rgb(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Hue 0..360, saturation and lightness 0..1. */
export function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = rgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio 1..21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Shortest distance between two hues, 0..1 (0 = same hue, 1 = opposite). */
export function hueDistance(a: string, b: string): number {
  const d = Math.abs(hsl(a).h - hsl(b).h) % 360;
  return Math.min(d, 360 - d) / 180;
}

/** Rough perceptual distance (redmean), 0..~765. Two colours under ~40 read as the same brand colour. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}

export const SAME_COLOR = 40;

export function isNeutral(hex: string): boolean {
  const { s, l } = hsl(hex);
  return s < 0.15 || l < 0.1 || l > 0.94;
}

const HUES = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export function hueName(hex: string): string {
  if (isNeutral(hex)) return hsl(hex).l < 0.5 ? "dark" : "light";
  const h = hsl(hex).h;
  const edges = [15, 45, 70, 160, 195, 255, 290, 340];
  const i = edges.findIndex((e) => h < e);
  return i === -1 ? "red" : HUES[i];
}
