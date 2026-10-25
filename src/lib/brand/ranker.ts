import { colorDistance, isHex, SAME_COLOR } from "./colormath";
import { FEATURE_VERSION } from "./features";
import { PRIOR, rankPool, type Weights } from "./heuristic";
import { BRAND_FIELDS, type BrandCandidates, type BrandField, type DecisionRecord, type Features, type FieldRecommendation } from "./types";

// The learned ranker (source "learned"): pairwise logistic preference (chosen ≻ every other
// candidate) over the candidate features, starting from the heuristic weights and pulled back to
// them by L2, so a handful of decisions nudges and many decisions dominate. Decisions from
// similar companies (profile embedding cosine) weigh more; the same company's own past choice is
// a direct precedent — a returning company gets what its manager picked last time.

export interface Target {
  host: string;
  embedding?: number[];
  embeddingMode?: "live" | "offline";
}

export function cosine(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

const sameHost = (a: string, b: string) => a.replace(/^www\./, "").toLowerCase() === b.replace(/^www\./, "").toLowerCase();

/** How much a past decision should count for this target company. */
export function similarity(d: DecisionRecord, t?: Target): number {
  if (!t) return 1;
  if (sameHost(d.host, t.host)) return 3;
  if (d.embeddingMode && d.embeddingMode === t.embeddingMode) return 0.5 + Math.max(0, cosine(d.embedding, t.embedding));
  return 1;
}

export const sameValue = (field: BrandField, a: string, b: string) =>
  field === "primary" || field === "accent" ? isHex(a) && isHex(b) && colorDistance(a, b) < SAME_COLOR : a.trim().toLowerCase() === b.trim().toLowerCase();

/** Training hyper-parameters (tuned on the cases/brand replay, see scripts/eval-brand.ts). */
export const RANKER_DEFAULTS = { epochs: 50, lr: 0.01, l2: 2, skip: [] as string[] };

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Weights for one field after learning from history (the prior when there is none). */
export function trainRanker(field: BrandField, history: DecisionRecord[], target?: Target, opts: Partial<typeof RANKER_DEFAULTS> = {}): Weights {
  const prior = PRIOR[field];
  const rows = history.filter((d) => d.field === field && d.featureVersion === FEATURE_VERSION);
  if (!rows.length) return { ...prior };
  const delta: Weights = {};
  const { epochs, lr, l2, skip } = { ...RANKER_DEFAULTS, ...opts };
  const learnable = (k: string) => !skip.some((p) => k.startsWith(p));
  const pairs = rows.flatMap((d) => {
    const w = similarity(d, target);
    return d.features.filter((c) => !sameValue(field, c.value, d.chosen)).map((c) => ({ w, diff: diffOf(d.chosenFeatures, c.f) }));
  });
  for (let e = 0; e < epochs; e++) {
    for (const { w, diff } of pairs) {
      let s = 0;
      for (const [k, x] of Object.entries(diff)) s += ((prior[k] ?? 0) + (delta[k] ?? 0)) * x;
      const g = -sigmoid(-s) * w;
      for (const [k, x] of Object.entries(diff)) if (learnable(k)) delta[k] = (delta[k] ?? 0) - lr * g * x;
    }
    for (const k of Object.keys(delta)) delta[k] *= 1 - lr * l2;
  }
  const out: Weights = { ...prior };
  for (const [k, d] of Object.entries(delta)) out[k] = (out[k] ?? 0) + d;
  return out;
}

function diffOf(a: Features, b: Features): Features {
  const out: Features = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    if (d) out[k] = d;
  }
  return out;
}

const LABELS: Record<string, string> = {
  var_brand: "named brand in CSS",
  var_action: "the CSS button/action colour",
  var_accent: "named accent in CSS",
  theme_color: "the site's theme-color",
  role_primary: "marked primary",
  role_accent: "marked accent",
  role_button: "used on buttons",
  role_link: "used on links",
  vivid: "a vivid colour",
  sat: "saturated",
  usage: "most used",
  top: "most used",
  hueFromPrimary: "contrasts with the primary hue",
  ctx_heading: "used for headings",
  display: "a display face",
  medium: "medium rounding",
  small: "subtle rounding",
  large: "generous rounding",
  pill: "pill shapes",
  sharp: "square corners",
  readable: "readable on the page",
  serif: "a serif",
};

/** Short "why": the features that most separate the winner from the runner-up. */
function why(w: Weights, best: Features, next?: Features): string {
  const contrib = Object.entries(best)
    .map(([k, x]) => [k, (w[k] ?? 0) * (x - (next?.[k] ?? 0))] as const)
    .filter(([k, c]) => c > 0.05 && LABELS[k])
    .sort((a, b) => b[1] - a[1]);
  const labels = [...new Set(contrib.map(([k]) => LABELS[k]))].slice(0, 2);
  return labels.length ? labels.join(", ") : "best overall match";
}

/** Per-field recommendation from the learned ranker (or the heuristic with no history). */
export type LearnedField = FieldRecommendation & { scores: { value: string; score: number }[]; precedent: boolean };

export function learnedRecommend(c: BrandCandidates, history: DecisionRecord[], target?: Target): Record<BrandField, LearnedField> {
  const out = {} as Record<BrandField, LearnedField>;
  for (const field of BRAND_FIELDS) {
    const rows = history.filter((d) => d.field === field && d.featureVersion === FEATURE_VERSION);
    const w = trainRanker(field, rows, target);
    const ranked = rankPool(field, c, w, out.primary?.recommended);
    const candidates = ranked.map((r) => r.candidate);
    const scores = ranked.map((r) => ({ value: r.raw.value, score: Math.round(r.score * 100) / 100 }));
    if (!ranked.length) {
      out[field] = { candidates, scores, recommended: "", reason: "nothing found on the site", source: "heuristic", precedent: false };
      continue;
    }
    // A returning company: its own last decision for this field wins when that value is on offer.
    const own = target ? [...rows].reverse().find((d) => sameHost(d.host, target.host)) : undefined;
    const precedent = own && ranked.find((r) => sameValue(field, r.raw.value, own.chosen));
    if (precedent) {
      out[field] = { candidates: [precedent.candidate, ...candidates.filter((x) => x.value !== precedent.raw.value)], scores, recommended: precedent.raw.value, reason: `chosen for ${target!.host} before`, source: "learned", precedent: true };
      continue;
    }
    const reason = why(w, ranked[0].f, ranked[1]?.f);
    out[field] = rows.length
      ? { candidates, scores, recommended: ranked[0].raw.value, reason: `learned from ${rows.length} decision${rows.length === 1 ? "" : "s"}: ${reason}`, source: "learned", precedent: false }
      : { candidates, scores, recommended: ranked[0].raw.value, reason, source: "heuristic", precedent: false };
  }
  return out;
}

/** Nearest past companies (by profile similarity) with what their managers chose — for the prompt. */
export function nearestPrecedents(history: DecisionRecord[], target: Target, k = 5) {
  const byHost = new Map<string, { host: string; category?: string; industry?: string; sim: number; choices: Partial<Record<BrandField, { chosen: string; recommended: string; accepted: boolean }>> }>();
  for (const d of history) {
    const sim = sameHost(d.host, target.host) ? 1 : d.embeddingMode === target.embeddingMode ? cosine(d.embedding, target.embedding) : 0;
    const cur = byHost.get(d.host) ?? { host: d.host, category: d.category, industry: d.industry, sim, choices: {} };
    cur.choices[d.field] = { chosen: d.chosen, recommended: d.recommended, accepted: d.accepted };
    byHost.set(d.host, cur);
  }
  return [...byHost.values()].sort((a, b) => b.sim - a.sim).slice(0, k).map((p) => ({ ...p, sim: Math.round(p.sim * 100) / 100 }));
}
