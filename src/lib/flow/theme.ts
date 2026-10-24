import { tokensToCssVars, type DesignTokens } from "@/lib/schemas/tokens";
import type { FlowSpec } from "./spec";

// Theme resolution shared by the in-app renderer and the exporter.

export function mergeTokens(tokens: DesignTokens, spec: Pick<FlowSpec, "themeOverrides">): DesignTokens {
  if (!spec.themeOverrides) return tokens;
  return { ...tokens, colors: { ...tokens.colors, ...spec.themeOverrides } };
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Black or white, whichever reads better on the given colour. */
export function readableOn(hex: string): string {
  return contrast(hex, "#ffffff") >= contrast(hex, "#111111") ? "#ffffff" : "#111111";
}

/** All CSS custom properties a flow needs: token vars plus derived on-colour and shadow vars. */
export function flowCssVars(spec: Pick<FlowSpec, "themeOverrides">, tokens: DesignTokens): Record<string, string> {
  const t = mergeTokens(tokens, spec);
  return {
    ...tokensToCssVars(t),
    "--ob-on-primary": readableOn(t.colors.primary),
    "--ob-on-accent": readableOn(t.colors.accent),
    "--ob-shadow":
      t.shadows[0] ??
      (t.mode === "dark"
        ? "0 1px 0 rgba(255,255,255,0.04) inset, 0 30px 60px -30px rgba(0,0,0,0.6)"
        : "0 1px 2px rgba(16,24,40,0.06), 0 28px 56px -28px rgba(16,24,40,0.28)"),
  };
}

export function googleFontsHref(tokens: DesignTokens): string | null {
  const fams = tokens.typography.googleFonts.filter(Boolean);
  if (fams.length === 0) return null;
  const q = fams
    .map((f) => `family=${f.includes(":") ? f.replace(/ /g, "+") : `${f.replace(/ /g, "+")}:wght@400;500;600;700`}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${q}&display=swap`;
}
