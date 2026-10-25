import type { CSSProperties } from "react";
import type { Doc } from "@convex/_generated/dataModel";
import { logoChip, luminance } from "@/lib/brand/themes";

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
    // --ink is also the dark UI colour (sidebar, ghost buttons, modals): a theme with light page
    // text (Dark, Bold) keeps it dark and gets `theme-dark` from brandClass instead.
    "--ink": lightText(brand) ? DEFAULTS.ink : (pick(brand, "text") ?? DEFAULTS.ink),
    "--paper": pick(brand, "surface") ?? DEFAULTS.paper,
    "--font-heading": font(brand.typography.heading),
    "--font-body": font(brand.typography.body),
    ...(brand.radius ? { "--radius": brand.radius } : {}),
  } as CSSProperties;
}

const lightText = (brand: BrandProfile) => {
  const text = pick(brand, "text");
  return !!text && luminance(text) > 0.5;
};

/** Classes for the picked theme's style (D-34): `theme-glass`, `theme-bold`, `theme-dark` (light text). */
export function brandClass(brand: BrandProfile | null | undefined): string {
  if (!brand) return "";
  return [brand.themeStyle && brand.themeStyle !== "flat" ? `theme-${brand.themeStyle}` : "", lightText(brand) ? "theme-dark" : ""].filter(Boolean).join(" ");
}

/** The space's logo (a mark or wordmark copied at scan time) and the chip it needs on the sidebar. */
export function brandLogo(brand: BrandProfile | null | undefined): { url: string; chip: "light" | "dark" | null; wordmark: boolean } | null {
  const logo = brand?.logoRefs.find((l) => l.kind !== "favicon");
  if (!logo) return null;
  // The sidebar is dark (--ink), except under the frosted-glass theme where it is near-white.
  return { url: logo.url, chip: logoChip(brand!.themeStyle === "glass" ? "#f5f5f7" : "#101014", logo.tone), wordmark: logo.kind === "wordmark" };
}

/** Two-letter initials for the space badge (mockup `B.initials`). */
export function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 2).toUpperCase() || "OB";
}
