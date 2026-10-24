import { z } from "zod";

// Design tokens extracted from the target site. Every flow theme is derived from this shape.

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const DesignTokens = z.object({
  colors: z.object({
    primary: hex,
    secondary: hex,
    accent: hex,
    background: hex,
    surface: hex,
    text: hex,
    mutedText: hex,
    border: hex,
  }),
  palette: z.array(z.object({ hex, usage: z.string().optional(), count: z.number().int().optional() })).default([]),
  typography: z.object({
    headingFont: z.string(),
    bodyFont: z.string(),
    monoFont: z.string().optional(),
    googleFonts: z.array(z.string()).default([]),
    baseSizePx: z.number().min(10).max(24).default(16),
    headingWeight: z.number().int().min(100).max(900).default(700),
  }),
  radii: z.object({ sm: z.number(), md: z.number(), lg: z.number(), pill: z.number().default(999) }),
  spacing: z.object({ unit: z.number().min(2).max(16).default(8) }),
  shadows: z.array(z.string()).default([]),
  logo: z.object({ url: z.string().url().nullable(), alt: z.string().default("") }).default({ url: null, alt: "" }),
  mode: z.enum(["light", "dark"]).default("light"),
});
export type DesignTokens = z.infer<typeof DesignTokens>;

export const DEFAULT_TOKENS: DesignTokens = {
  colors: {
    primary: "#2f5d4a",
    secondary: "#1f2933",
    accent: "#d9480f",
    background: "#fbfaf7",
    surface: "#ffffff",
    text: "#1f2933",
    mutedText: "#616e7c",
    border: "#e4e7eb",
  },
  palette: [],
  typography: { headingFont: "Georgia, serif", bodyFont: "system-ui, sans-serif", googleFonts: [], baseSizePx: 16, headingWeight: 600 },
  radii: { sm: 4, md: 8, lg: 16, pill: 999 },
  spacing: { unit: 8 },
  shadows: [],
  logo: { url: null, alt: "" },
  mode: "light",
};

/** CSS custom properties for a theme. Used by the in-app renderer and by the exported component. */
export function tokensToCssVars(t: DesignTokens): Record<string, string> {
  return {
    "--ob-primary": t.colors.primary,
    "--ob-secondary": t.colors.secondary,
    "--ob-accent": t.colors.accent,
    "--ob-bg": t.colors.background,
    "--ob-surface": t.colors.surface,
    "--ob-text": t.colors.text,
    "--ob-muted": t.colors.mutedText,
    "--ob-border": t.colors.border,
    "--ob-font-heading": t.typography.headingFont,
    "--ob-font-body": t.typography.bodyFont,
    "--ob-font-size": `${t.typography.baseSizePx}px`,
    "--ob-heading-weight": String(t.typography.headingWeight),
    "--ob-radius-sm": `${t.radii.sm}px`,
    "--ob-radius-md": `${t.radii.md}px`,
    "--ob-radius-lg": `${t.radii.lg}px`,
    "--ob-space": `${t.spacing.unit}px`,
  };
}

export function cssVarsBlock(t: DesignTokens, selector = ":root"): string {
  const vars = tokensToCssVars(t);
  return `${selector} {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
}
