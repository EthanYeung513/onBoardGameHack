import { fieldPool, toCandidate } from "./normalise";
import { colorDistance, isHex, SAME_COLOR } from "./colormath";
import { poolFeatures } from "./features";
import { BRAND_FIELDS, type BrandCandidates, type BrandField, type Features } from "./types";

// Cold-start ranking: hand-set weights over the candidate features (source "heuristic"). The
// learned ranker (ranker.ts) starts from these same weights and moves them with decisions.

export type Weights = Record<string, number>;

const colorPrior: Weights = {
  usage: 1,
  vivid: 2,
  sat: 1,
  neutral: -3,
  pale: -1,
  readable: 0.5,
  var_brand: 2,
  var_action: 2.5,
  var_accent: 0.5,
  var_text: -1,
  var_bg: -1.5,
  theme_color: 1.5,
  role_primary: 2.5,
  role_button: 1,
  role_link: 0.5,
  role_text: -1.5,
  role_bg: -2,
};

export const PRIOR: Record<BrandField, Weights> = {
  primary: colorPrior,
  accent: { ...colorPrior, var_brand: 0.5, var_action: 0.5, role_primary: 0.5, var_accent: 2.5, role_accent: 2.5, samePrimary: -6, hueFromPrimary: 1.5 },
  radius: { usage: 2, top: 1, pill: -1.5, sharp: -0.5, small: 0.5, medium: 0.8, var_any: 1, role_button: 0.5 },
  headline: { usage: 1, ctx_heading: 2.5, display: 1, var_any: 0.5, icon: -6, mono: -2, system: -1, ctx_body: -0.3 },
};

export const score = (w: Weights, f: Features) => Object.entries(f).reduce((s, [k, x]) => s + (w[k] ?? 0) * x, 0);

/** The options offered for a field. The accent must differ from the primary (unless nothing else exists). */
export function poolFor(field: BrandField, c: BrandCandidates, primary?: string) {
  const pool = fieldPool(field, c, field === "accent" ? 9 : 8);
  if (field !== "accent" || !primary) return pool.slice(0, 8);
  const rest = pool.filter((x) => !(isHex(x.value) && isHex(primary) && colorDistance(x.value, primary) < SAME_COLOR));
  return (rest.length ? rest : pool).slice(0, 8);
}

/** Ranked candidate values (best first) for one field under a weight vector. */
export function rankPool(field: BrandField, c: BrandCandidates, w: Weights, primary?: string) {
  const pool = poolFor(field, c, primary);
  const feats = poolFeatures(field, pool, { surface: c.surface, primary });
  return pool
    .map((raw, i) => ({ raw, candidate: toCandidate(raw), f: feats[i].f, score: score(w, feats[i].f) }))
    .sort((a, b) => b.score - a.score);
}

const FALLBACK: Record<BrandField, string> = { primary: "#2f6bff", accent: "#ff5c39", radius: "12px", headline: "Inter" };

/** Heuristic brand tokens — what extract_design used before learning (and the cold-start answer). */
export function heuristicTokens(c: BrandCandidates): Record<BrandField, string> {
  const out = {} as Record<BrandField, string>;
  for (const field of BRAND_FIELDS) out[field] = rankPool(field, c, PRIOR[field], out.primary)[0]?.raw.value ?? FALLBACK[field];
  return out;
}

export { FALLBACK as FALLBACK_TOKENS };
