import type { BrandCandidates, Candidate, ColorRole, HintRole } from "./candidates";
import { contrast, hueDistance, isChromatic, luminance } from "./color";

// THE place final brand tokens are chosen from the candidates extract_design collected.
// Heuristic for now; the brand-learning service swaps this for its learned Mubit recommender
// (same input, same output), so keep the signature stable.

export interface PickedValue {
  value: string;
  reason: string;
  /** Display name, colours only. */
  name?: string;
}

export interface PickedFont extends PickedValue {
  fallback: string;
  weight?: string;
}

export interface PickedTokens {
  colors: Record<ColorRole, PickedValue>;
  radius: PickedValue | null;
  headline: PickedFont;
  body: PickedFont;
  companyName: PickedValue | null;
}

const HINT_WEIGHT = { model: 6, site: 4, css: 2 } as const;

function hintScore(c: Candidate, role: HintRole) {
  return c.hints.filter((h) => h.role === role).reduce((s, h) => s + HINT_WEIGHT[h.by], 0);
}

function score(c: Candidate, role: HintRole) {
  return hintScore(c, role) + Math.log10(c.count + 1);
}

function best(list: Candidate[], role: HintRole, ok: (c: Candidate) => boolean = () => true) {
  return list.filter(ok).sort((a, b) => score(b, role) - score(a, role))[0];
}

function why(c: Candidate, role: HintRole) {
  const hinted = c.hints.filter((h) => h.role === role).map((h) => h.by);
  const votes = hinted.length ? `${role} per ${[...new Set(hinted)].join(" + ")}` : "most used";
  return `${votes}; ${c.evidence.slice(0, 2).join("; ")}`;
}

const ROLE_NAMES: Record<ColorRole, string> = { primary: "Primary", accent: "Accent", surface: "Surface", text: "Text" };

function color(c: Candidate, role: ColorRole, reason?: string): PickedValue {
  return { value: c.value, name: c.name ?? ROLE_NAMES[role], reason: reason ?? why(c, role) };
}

export function pickBrandTokens(c: BrandCandidates): PickedTokens {
  const palette = c.palette;

  const surfaceC = best(palette, "surface", (x) => luminance(x.value) >= 0.8 || hintScore(x, "surface") >= HINT_WEIGHT.site);
  const surface = surfaceC ? color(surfaceC, "surface") : { value: "#ffffff", name: "Surface", reason: "no light surface colour found; white" };

  const readable = (x: Candidate) => contrast(x.value, surface.value) >= 4.5;
  const textC = best(palette, "text", (x) => readable(x) && luminance(x.value) < 0.2) ?? best(palette, "text", readable);
  const text = textC
    ? color(textC, "text")
    : { value: luminance(surface.value) > 0.4 ? "#111111" : "#ffffff", name: "Text", reason: "no readable text colour found; neutral for contrast" };

  const primaryC = best(palette, "primary", (x) => isChromatic(x.value) || hintScore(x, "primary") >= HINT_WEIGHT.model);
  const primary = primaryC ? color(primaryC, "primary") : { ...text, name: "Primary", reason: "no chromatic brand colour on the site (monochrome brand); using the text colour" };

  const accentC = best(palette, "accent", (x) => x.value !== primary.value && isChromatic(x.value) && (hueDistance(x.value, primary.value) >= 30 || hintScore(x, "accent") > 0));
  const accent = accentC ? color(accentC, "accent") : { ...primary, name: "Accent", reason: "no second brand colour found; reusing primary" };

  const radiusC = best(c.radius, "radius", (x) => /^\d+(\.\d+)?(px|rem|em)$/.test(x.value) && parseFloat(x.value) > 0 && parseFloat(x.value) < 40);
  const headlineC = best(c.headline, "headline");
  const bodyC = best(c.body, "body");
  const system = { value: "Inter", fallback: "-apple-system, sans-serif", reason: "no web font found; system stack" };
  const font = (x: Candidate | undefined, role: "headline" | "body"): PickedFont =>
    x ? { value: x.value, fallback: x.fallback ?? "sans-serif", weight: x.weight, reason: why(x, role) } : system;
  const nameC = best(c.companyName, "name");

  return {
    colors: { primary, accent, surface, text },
    radius: radiusC ? { value: radiusC.value, reason: why(radiusC, "radius") } : null,
    headline: font(headlineC, "headline"),
    body: font(bodyC ?? headlineC, "body"),
    companyName: nameC ? { value: nameC.value, reason: why(nameC, "name") } : null,
  };
}
