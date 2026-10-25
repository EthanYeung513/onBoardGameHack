import type { CSSProperties } from "react";
import type { Doc } from "@convex/_generated/dataModel";

// Product surfaces resolve colours through the space's brand tokens (AGENTS.md "Design"), the
// real version of the mockup's `setProperty('--brand', B.primary)` / `('--accent', B.accent)`.
// No brand profile yet → the mockup's Orthogonal defaults from styles.css. Never hard-code a
// company colour: wrap a surface in `<div style={brandVars(space.brand)}>` and use the variables.

export type BrandProfile = Doc<"brand_profiles">;

const DEFAULTS = { brand: "#2f6bff", accent: "#ff5c39", ink: "#101014", paper: "#ffffff" };

const pick = (b: BrandProfile, role: BrandProfile["palette"][number]["role"]) => b.palette.find((p) => p.role === role)?.hex;

/** CSS variables for a surface: --brand, --accent, --ink, --paper, --font-heading, --font-body. */
export function brandVars(brand: BrandProfile | null | undefined): CSSProperties {
  if (!brand) return { "--brand": DEFAULTS.brand, "--accent": DEFAULTS.accent } as CSSProperties;
  const font = (f: { family: string; fallback?: string }) => `"${f.family}", ${f.fallback ?? "Inter, -apple-system, sans-serif"}`;
  return {
    "--brand": pick(brand, "primary") ?? DEFAULTS.brand,
    "--accent": pick(brand, "accent") ?? DEFAULTS.accent,
    "--ink": pick(brand, "text") ?? DEFAULTS.ink,
    "--paper": pick(brand, "surface") ?? DEFAULTS.paper,
    "--font-heading": font(brand.typography.heading),
    "--font-body": font(brand.typography.body),
  } as CSSProperties;
}

/** Two-letter initials for the space badge (mockup `B.initials`). */
export function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 2).toUpperCase() || "OB";
}
