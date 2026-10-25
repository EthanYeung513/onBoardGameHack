import type { StyleCues } from "./candidates";

// Theme variants from a company's extracted identity (D-34, Nicole: "the scan exists to understand
// brand identity; its output is several theme variants the manager picks between"). Pure: the
// extract_design stage builds them, the theme cards render them, `brand.pickTheme` applies one.
// Every variant uses the company's own fonts, logo and palette; the style follows the site's cues
// (a site built on backdrop-blur glass gets a frosted-glass option).

export type ThemeStyle = "flat" | "glass" | "bold" | "gradient";

export interface Theme {
  id: string;
  name: string;
  palette: { primary: string; accent: string; surface: string; text: string };
  headingFont: string;
  bodyFont: string;
  /** CSS length, e.g. "12px". */
  radius: string;
  style: ThemeStyle;
  logoUrl: string | null;
  logoTone?: "light" | "dark" | null;
  /** The variant built from the recommended tokens (Mubit / learned / heuristic). */
  recommended?: boolean;
}

export interface ThemeInput {
  primary: string;
  accent: string;
  surface: string;
  text: string;
  headingFont: string;
  bodyFont: string;
  radius: string | null;
  style?: StyleCues | null;
  logoUrl?: string | null;
  logoTone?: "light" | "dark" | null;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0) as [number, number, number];
}

/** WCAG relative luminance (0 dark … 1 light). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text colour on a background. */
export const onColor = (bg: string) => (luminance(bg) > 0.45 ? "#111114" : "#ffffff");

/** "light"/"dark" chip behind a logo that would vanish on this background, else null. */
export function logoChip(background: string, tone: "light" | "dark" | null | undefined): "light" | "dark" | null {
  const darkBg = luminance(background) < 0.2;
  if (darkBg && tone !== "light") return "light";
  if (!darkBg && tone === "light") return "dark";
  return null;
}

/** The site's style, strongest cue first. */
export function dominantStyle(cues?: StyleCues | null): ThemeStyle {
  if (!cues) return "flat";
  if (cues.glass >= 3 || (cues.glass >= 1 && cues.translucent >= 10)) return "glass";
  if (cues.gradients >= 6) return "gradient";
  return "flat";
}

export function buildThemes(t: ThemeInput): Theme[] {
  const style = dominantStyle(t.style);
  const radius = t.radius ?? (t.style?.roundRadius ? `${t.style.roundRadius}px` : "10px");
  const base = { headingFont: t.headingFont, bodyFont: t.bodyFont, logoUrl: t.logoUrl ?? null, logoTone: t.logoTone ?? null };
  const lightSurface = luminance(t.surface) > 0.6 ? t.surface : "#ffffff";
  const darkSurface = luminance(t.surface) < 0.08 ? t.surface : "#0f0f12";
  const themes: Theme[] = [
    { id: "signature", name: style === "glass" ? "Frosted glass" : "Signature", palette: { primary: t.primary, accent: t.accent, surface: t.surface, text: t.text }, radius, style, recommended: true, ...base },
    { id: "light", name: "Light", palette: { primary: t.primary, accent: t.accent, surface: lightSurface, text: onColor(lightSurface) }, radius, style: style === "glass" ? "flat" : style, ...base },
    { id: "dark", name: "Dark", palette: { primary: t.primary, accent: t.accent, surface: darkSurface, text: onColor(darkSurface) }, radius, style: style === "glass" ? "flat" : style, ...base },
  ];
  // A frosted-glass option whenever the site uses glass; when glass is already the site's own
  // style the signature theme is that option, so the fourth card is Bold instead.
  if (style !== "glass" && (t.style?.glass ?? 0) > 0) {
    // Frosted glass: translucent cards over a soft wash of the brand colours.
    themes.push({ id: "glass", name: "Frosted glass", palette: { primary: t.primary, accent: t.accent, surface: "#f5f5f7", text: "#1d1d1f" }, radius: t.style?.roundRadius ? `${Math.max(16, t.style.roundRadius)}px` : "18px", style: "glass", ...base });
  } else {
    // The brand colour as the page; primary/accent stay the company's own (theme picks are
    // learned as colour decisions), the style puts the accent on buttons.
    themes.push({ id: "bold", name: "Bold", palette: { primary: t.primary, accent: t.accent, surface: t.primary, text: onColor(t.primary) }, radius, style: "bold", ...base });
  }
  // The signature theme is already the site's own style; drop a variant that duplicates it.
  const seen = new Set<string>();
  return themes.filter((th) => {
    const key = `${th.palette.surface}|${th.palette.text}|${th.style}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000" };

/**
 * Light or dark ink of an SVG logo, from the colours it declares (fill/stroke attributes and
 * styles; undeclared fill is black). Null for rasters or when it can't tell. Used to give a logo
 * a contrasting chip only where it would vanish (a white mark on a dark sidebar is fine bare).
 */
export function svgLogoTone(svg: string): "light" | "dark" | null {
  const values = [...svg.matchAll(/(?:fill|stroke)\s*[:=]\s*["']?\s*(#[0-9a-f]{3,8}|white|black|rgba?\([^)]*\))/gi)].map((m) => m[1].toLowerCase());
  const hexes = values
    .map((c) => {
      if (NAMED[c]) return NAMED[c];
      const rgb = c.match(/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
      if (rgb) return `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
      return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}/.test(c) ? c.slice(0, 7) : null;
    })
    .filter((h): h is string => !!h);
  if (!hexes.length) return /<(path|rect|circle|polygon|text|ellipse)\b/i.test(svg) ? "dark" : null;
  const avg = hexes.reduce((a, h) => a + luminance(h), 0) / hexes.length;
  return avg > 0.6 ? "light" : "dark";
}
