import { colorDistance, contrast, hsl, hueDistance, isHex, isNeutral, SAME_COLOR } from "./colormath";
import { radiusPx } from "./normalise";
import type { BrandField, Features, RawCandidate } from "./types";

// Per-candidate features the ranker learns preference weights over. Bump FEATURE_VERSION when a
// feature changes meaning; stored decisions with another version are ignored by the ranker.

export const FEATURE_VERSION = 2;

/** Variables that name the main action colour: --button-primary-bg, --color-interactive-primary, --theme-bg-cta… */
const ACTION_VAR = /(button|btn|cta|action|interactive)[-_]*(primary)?[-_]*(bg|background|fill)?$|(button|btn|action|interactive)[-_]+primary[-_]+(bg|background|fill)|primary[-_]+(button|btn|action|cta)|bg[-_]+cta/i;

const has = (c: RawCandidate, re: RegExp) => (c.where.some((w) => re.test(w)) ? 1 : 0);
const varNamed = (c: RawCandidate, re: RegExp) => (c.where.some((w) => w.startsWith("css-var:") && re.test(w.slice(8))) ? 1 : 0);

function shared(c: RawCandidate, pool: RawCandidate[]): Features {
  const max = Math.max(1, ...pool.map((p) => p.usage));
  const rank = [...pool].sort((a, b) => b.usage - a.usage).findIndex((p) => p.value === c.value);
  return { usage: Math.log1p(c.usage) / Math.log1p(max), top: rank === 0 ? 1 : 0, rankInv: rank < 0 ? 0 : 1 / (rank + 1) };
}

function colorFeatures(c: RawCandidate, pool: RawCandidate[], surface: string, primary?: string): Features {
  if (!isHex(c.value)) return {};
  const { h, s, l } = hsl(c.value);
  const f: Features = {
    ...shared(c, pool),
    sat: s,
    light: l,
    neutral: isNeutral(c.value) ? 1 : 0,
    vivid: s > 0.45 && l > 0.25 && l < 0.75 ? 1 : 0,
    dark: l < 0.2 ? 1 : 0,
    pale: l > 0.85 ? 1 : 0,
    contrast: Math.min(contrast(c.value, surface), 21) / 21,
    readable: contrast(c.value, surface) >= 3 ? 1 : 0,
    var_brand: varNamed(c, /brand|logo/i),
    var_action: varNamed(c, ACTION_VAR),
    var_accent: varNamed(c, /accent|secondary|highlight/i),
    var_text: varNamed(c, /text|fg|foreground|ink|content/i),
    var_bg: varNamed(c, /bg|background|surface/i),
    var_any: has(c, /^css-var:/),
    theme_color: has(c, /^theme-color$/),
    role_primary: has(c, /^role:(primary|brand)/),
    role_accent: has(c, /^role:(accent|secondary)/),
    role_button: has(c, /^role:(button|cta)|button/),
    role_link: has(c, /^role:link|link/),
    role_logo: has(c, /logo/),
    role_text: has(c, /^role:text/),
    role_bg: has(c, /^role:(background|surface)/),
  };
  // Hue buckets let similar companies' preferences transfer (e.g. fintech → blue) via precedents.
  const bucket = s < 0.15 ? -1 : Math.floor(((h + 22.5) % 360) / 45);
  for (let i = 0; i < 8; i++) f[`hue${i}`] = bucket === i ? 1 : 0;
  if (primary && isHex(primary)) {
    f.samePrimary = colorDistance(c.value, primary) < SAME_COLOR ? 1 : 0;
    f.hueFromPrimary = isNeutral(c.value) || isNeutral(primary) ? 0 : hueDistance(c.value, primary);
  }
  return f;
}

function radiusFeatures(c: RawCandidate, pool: RawCandidate[]): Features {
  const px = radiusPx(c.value);
  return {
    ...shared(c, pool),
    px: Math.min(px, 32) / 32,
    sharp: px <= 2 ? 1 : 0,
    small: px > 2 && px <= 6 ? 1 : 0,
    medium: px > 6 && px <= 12 ? 1 : 0,
    large: px > 12 && px < 100 ? 1 : 0,
    pill: px >= 100 ? 1 : 0,
    var_any: has(c, /^css-var:/),
    role_button: has(c, /button|btn|cta/),
  };
}

const SYSTEM_FONTS = /^(arial|helvetica|helvetica neue|segoe ui|roboto|times|times new roman|georgia|verdana|tahoma|system-ui|sf pro.*|noto ?sans.*|hiragino.*|-apple-system.*|ubuntu|inter)$/i;
const ICON_FONTS = /icon|awesome|material symbols|glyph|emoji|^symbol$|katex/i;
const SERIF = /serif|georgia|times|garamond|playfair|merriweather|lora|tiempos|freight|domaine|recoleta|canela|caslon|baskerville|didot/i;
const MONO = /mono|code|courier|consolas|monaco|menlo/i;

function fontFeatures(c: RawCandidate, pool: RawCandidate[]): Features {
  const v = c.value;
  return {
    ...shared(c, pool),
    serif: SERIF.test(v) && !/sans/i.test(v) ? 1 : 0,
    mono: MONO.test(v) ? 1 : 0,
    system: SYSTEM_FONTS.test(v) ? 1 : 0,
    icon: ICON_FONTS.test(v) ? 1 : 0,
    display: /display|headline|heading|title/i.test(v) ? 1 : 0,
    text_cut: /text$|[-_ ]text\b|body|ui$/i.test(v) ? 1 : 0,
    ctx_heading: has(c, /^context:(heading|h1|h2|display|title)/),
    ctx_body: has(c, /^context:(body|p|text)/),
    var_any: has(c, /^css-var:/),
  };
}

/** Features for one candidate of a field. `primary` is the chosen/recommended primary (accent only). */
export function candidateFeatures(field: BrandField, c: RawCandidate, pool: RawCandidate[], opts: { surface?: string; primary?: string } = {}): Features {
  if (field === "radius") return radiusFeatures(c, pool);
  if (field === "headline") return fontFeatures(c, pool);
  return colorFeatures(c, pool, opts.surface ?? "#ffffff", field === "accent" ? opts.primary : undefined);
}

export function poolFeatures(field: BrandField, pool: RawCandidate[], opts: { surface?: string; primary?: string } = {}) {
  return pool.map((c) => ({ value: c.value, f: candidateFeatures(field, c, pool, opts) }));
}
