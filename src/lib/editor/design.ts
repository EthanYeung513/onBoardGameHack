import type { CSSProperties } from "react";
import { ConvexError } from "convex/values";
import { brandVars, type BrandProfile } from "@/components/manager/brand";
import type { BrandCandidate, BrandField, BrandFieldOptions } from "@/components/editor/contracts";

// Pure helpers behind the editor's Design tab and toasts (kept out of the components so they are
// testable without a DOM).

/** The mockup's headline styles (editor.html <select>). */
export const HEADLINE_PRESETS = ["Bold editorial", "Clean sans", "Friendly rounded"] as const;

export const SOURCE_LABEL: Record<BrandFieldOptions["source"], string> = { mubit: "Mubit", learned: "Learned", heuristic: "Heuristic" };

export type Choice = BrandCandidate & { recommended: boolean };

/** Recommended option first, then the other extracted candidates (deduped, original order). */
export function orderedChoices(opts: BrandFieldOptions | undefined): Choice[] {
  if (!opts) return [];
  const key = (v: string) => v.trim().toLowerCase();
  const rec = opts.candidates.find((c) => key(c.value) === key(opts.recommended));
  const out: Choice[] = [{ value: opts.recommended, evidence: rec?.evidence, recommended: true }];
  const seen = new Set([key(opts.recommended)]);
  for (const c of opts.candidates) {
    if (seen.has(key(c.value))) continue;
    seen.add(key(c.value));
    out.push({ ...c, recommended: false });
  }
  return out;
}

export type DesignValues = { primary: string; accent: string; radius: number; headline: string };

export function radiusPx(value: string | number | undefined, fallback = 10): number {
  const n = typeof value === "number" ? value : parseFloat(value ?? "");
  return Number.isFinite(n) ? Math.max(0, Math.min(20, Math.round(n))) : fallback;
}

/** Current design values: local picks over the space's brand_profiles tokens over the mockup defaults. */
export function currentDesign(brand: BrandProfile | null | undefined, picks: Partial<DesignValues>, headlineDefault?: string): DesignValues {
  const vars = brandVars(brand) as Record<string, string>;
  return {
    primary: picks.primary ?? vars["--brand"],
    accent: picks.accent ?? vars["--accent"],
    radius: picks.radius ?? radiusPx(brand?.radius),
    headline: picks.headline ?? headlineDefault ?? HEADLINE_PRESETS[0],
  };
}

const HEADLINE_CSS: Record<string, { family: string; weight: number; spacing: string }> = {
  "bold editorial": { family: "var(--font-heading, inherit)", weight: 800, spacing: "-0.02em" },
  "clean sans": { family: '"Helvetica Neue", Inter, -apple-system, Arial, sans-serif', weight: 600, spacing: "-0.01em" },
  "friendly rounded": { family: 'ui-rounded, "SF Pro Rounded", Nunito, "Varela Round", sans-serif', weight: 700, spacing: "0" },
};

/** CSS variables for the live preview: brandVars + the Design tab's picks. */
export function designVars(brand: BrandProfile | null | undefined, d: DesignValues): CSSProperties {
  const h = HEADLINE_CSS[d.headline.trim().toLowerCase()] ?? { family: `"${d.headline}", var(--font-heading, inherit)`, weight: 700, spacing: "-0.01em" };
  // The editor chrome stays Orthogonal's (mockup --ink/--paper); only the preview takes the brand.
  const vars = { ...(brandVars(brand) as Record<string, string>) };
  delete vars["--ink"];
  delete vars["--paper"];
  return {
    ...vars,
    "--brand": d.primary,
    "--accent": d.accent,
    "--ed-radius": `${d.radius}px`,
    "--ed-h-family": h.family,
    "--ed-h-weight": String(h.weight),
    "--ed-h-spacing": h.spacing,
  } as CSSProperties;
}

/** Value sent to `brand.decide` for a field. */
export function decisionValue(field: BrandField, d: DesignValues): string {
  return field === "radius" ? `${d.radius}px` : d[field];
}

/** Toast copy for a failed write: 409/422 in the product's voice, never a raw error. */
export function errorMessage(err: unknown, action: string): string {
  const data = err instanceof ConvexError ? (err.data as { code?: number; message?: string }) : null;
  if (data?.code === 409) return "Someone else changed this course — showing the latest version.";
  if (data?.code === 422) return `That edit doesn't fit the course rules${data.message ? `: ${data.message}` : "."}`;
  if (data?.code === 403 || data?.code === 401) return "You don't have permission to edit this space.";
  if (data?.code === 503) return `${action} needs a provider that isn't configured yet.`;
  if (data?.message) return data.message;
  return `Couldn't ${action.toLowerCase()} — it isn't available yet. Try again later.`;
}
