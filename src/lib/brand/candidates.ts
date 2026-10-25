import { normaliseHex } from "./color";

// Every candidate brand value extract_design saw, with where it was found and how often
// (persisted on `brand_profiles.candidates`). `pickBrandTokens` (./pick.ts) chooses the final
// tokens from these; the Design tab / brand-learning service show them as the alternatives.

export type ColorRole = "primary" | "accent" | "surface" | "text";
export type HintRole = ColorRole | "headline" | "body" | "radius" | "name";

/** A vote for a role: `site` = the site's own semantics (dembrandt roles, theme-color, logo
 * colour), `css` = a CSS variable name, `model` = the LLM normalisation pass. */
export interface Hint {
  role: HintRole;
  by: "site" | "css" | "model";
}

export interface Candidate {
  value: string;
  count: number;
  evidence: string[];
  hints: Hint[];
  /** Human name (from the model pass), colours only. */
  name?: string;
  /** Font candidates: the rest of the CSS stack and the weight seen. */
  fallback?: string;
  weight?: string;
}

export interface LogoCandidate {
  kind: "mark" | "wordmark" | "favicon";
  /** Remote URL or data: URI — copied into Convex storage before it becomes a logo ref. */
  src: string;
  evidence: string;
}

export interface BrandCandidates {
  source: "dembrandt" | "html_css";
  palette: Candidate[];
  radius: Candidate[];
  headline: Candidate[];
  body: Candidate[];
  companyName: Candidate[];
  logos: LogoCandidate[];
  description: string | null;
}

/** The parts of `htmlCssEvidence` (src/lib/design/evidence.ts) used here. */
export interface HtmlEvidence {
  title?: string;
  siteName?: string | null;
  description?: string | null;
  themeColor?: string | null;
  colors?: { value: string; count: number }[];
  cssVariables?: Record<string, string>;
  fonts?: { value: string; count: number }[];
  radii?: { value: string; count: number }[];
  logoCandidates?: { src: string; alt: string; evidence?: string }[];
  icons?: string[];
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont", "inherit", "initial", "unset", "emoji", "math"]);

/** `"Inter", -apple-system, sans-serif` → { family: "Inter", fallback: "-apple-system, sans-serif" }. */
export function parseFontStack(stack: string): { family: string; fallback: string } | null {
  if (/var\(|!important/.test(stack)) stack = stack.replace(/!important/g, "");
  const parts = stack.split(",").map((p) => p.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  const i = parts.findIndex((p) => !GENERIC.has(p.toLowerCase()) && !p.startsWith("var("));
  if (i < 0) return null;
  const rest = parts.slice(i + 1).filter((p) => !p.startsWith("var("));
  return { family: parts[i].slice(0, 80), fallback: rest.join(", ") || "sans-serif" };
}

function varRole(name: string): ColorRole | null {
  const n = name.toLowerCase();
  if (/primary|brand/.test(n)) return "primary";
  if (/accent|secondary|highlight/.test(n)) return "accent";
  if (/(^|-)(bg|background|surface|canvas|paper)(-|$)/.test(n)) return "surface";
  if (/(^|-)(text|ink|foreground|fg|body-color)(-|$)/.test(n)) return "text";
  return null;
}

class Bag {
  private map = new Map<string, Candidate>();
  add(value: string, count: number, evidence: string, hint?: Hint, extra?: Partial<Candidate>) {
    const key = value.toLowerCase();
    const c = this.map.get(key) ?? { value, count: 0, evidence: [], hints: [], ...extra };
    c.count += count;
    if (!c.evidence.includes(evidence) && c.evidence.length < 8) c.evidence.push(evidence);
    if (hint && !c.hints.some((h) => h.role === hint.role && h.by === hint.by)) c.hints.push(hint);
    this.map.set(key, c);
  }
  list(limit = 16): Candidate[] {
    return [...this.map.values()].sort((a, b) => b.hints.length - a.hints.length || b.count - a.count).slice(0, limit);
  }
}

type Raw = Record<string, unknown>;
const arr = (x: unknown) => (Array.isArray(x) ? (x as Raw[]) : []);
const str = (x: unknown) => (typeof x === "string" ? x : null);

function companyFromTitle(title: string | undefined) {
  const t = title?.split(/\s[|\-–—:·]\s/)[0]?.trim();
  return t && t.length <= 60 ? t : null;
}

/** Merge dembrandt output (when it ran) and the HTML/CSS evidence into one candidate set. */
export function buildCandidates(html: HtmlEvidence, dembrandt?: Raw | null): BrandCandidates {
  const palette = new Bag();
  const radius = new Bag();
  const headline = new Bag();
  const body = new Bag();
  const names = new Bag();
  const logos: LogoCandidate[] = [];

  if (dembrandt) {
    const colors = (dembrandt.colors ?? {}) as Raw;
    for (const c of arr(colors.palette).slice(0, 24)) {
      const hex = normaliseHex(str(c.normalized) ?? str(c.color) ?? "");
      if (!hex) continue;
      const where = arr(c.sources).slice(0, 3).join(", ");
      palette.add(hex, Number(c.count) || 1, `dembrandt: used ${Number(c.count) || 1}× on rendered page${where ? ` (${where})` : ""}`);
      for (const tok of (c.tokens as string[] | undefined)?.slice(0, 6) ?? []) {
        const role = varRole(tok);
        if (role) palette.add(hex, 0, `css var ${tok}`, { role, by: "css" });
      }
    }
    const semantic = (colors.semantic ?? {}) as Record<string, string>;
    const map: Record<string, ColorRole> = { primary: "primary", accent: "accent", background: "surface", text: "text" };
    for (const [k, role] of Object.entries(map)) {
      const hex = semantic[k] ? normaliseHex(semantic[k]) : null;
      if (hex) palette.add(hex, 0, `dembrandt semantic ${k}`, { role, by: "site" });
    }
    const logo = (dembrandt.logo ?? null) as Raw | null;
    const logoColor = logo && str(logo.color) ? normaliseHex(str(logo.color)!) : null;
    if (logoColor) palette.add(logoColor, 0, "logo colour", { role: "primary", by: "site" });

    for (const s of arr((dembrandt.typography as Raw | undefined)?.styles).slice(0, 40)) {
      const family = str(s.family);
      if (!family) continue;
      const font = parseFontStack([family, str(s.fallbacks) ?? ""].filter(Boolean).join(", "));
      if (!font) continue;
      const ctx = str(s.context) ?? "text";
      const target = /heading|display|hero|title/.test(ctx) ? headline : body;
      target.add(font.family, Number(s.count) || 1, `dembrandt: ${ctx} ${str(s.size) ?? ""}`.trim(), undefined, { fallback: font.fallback, weight: s.weight != null ? String(s.weight) : undefined });
    }
    for (const r of arr((dembrandt.borderRadius as Raw | undefined)?.values).slice(0, 10)) {
      const value = str(r.value);
      if (value) radius.add(value, Number(r.count) || 1, `dembrandt: ${Number(r.count) || 1} elements (${arr(r.elements).slice(0, 3).join(", ")})`);
    }
    const siteName = str(dembrandt.siteName);
    if (siteName) names.add(siteName, 1, "dembrandt site name");
    if (logo) {
      const src = logo.inline || !str(logo.url) || str(logo.url) === dembrandt.url ? str(logo.dataUri) : str(logo.url);
      if (src) logos.push({ kind: str(logo.type) === "wordmark" ? "wordmark" : "mark", src, evidence: `dembrandt logo (${str(logo.context) ?? "page"})` });
    }
    const fav = arr(dembrandt.favicons)[0];
    const favSrc = fav ? (str(fav.url) ?? str(fav.dataUri)) : null;
    if (favSrc) logos.push({ kind: "favicon", src: favSrc, evidence: "dembrandt favicon" });
  }

  const theme = html.themeColor ? normaliseHex(html.themeColor) : null;
  if (theme) palette.add(theme, 0, "meta theme-color", { role: "primary", by: "site" });
  for (const c of html.colors ?? []) {
    const hex = normaliseHex(c.value);
    if (hex) palette.add(hex, c.count, `stylesheets: ${c.count} rules`);
  }
  for (const [name, value] of Object.entries(html.cssVariables ?? {})) {
    const hex = normaliseHex(value);
    const role = varRole(name);
    if (hex) palette.add(hex, 0, `css var ${name}`, role ? { role, by: "css" } : undefined);
    if (/radius/i.test(name) && /^\d/.test(value)) radius.add(value, 0, `css var ${name}`, { role: "radius", by: "css" });
  }
  for (const f of html.fonts ?? []) {
    const font = parseFontStack(f.value);
    if (!font) continue;
    for (const bag of [headline, body]) bag.add(font.family, f.count, `stylesheets: font-family in ${f.count} rules`, undefined, { fallback: font.fallback });
  }
  for (const r of html.radii ?? []) radius.add(r.value, r.count, `stylesheets: ${r.count} rules`);
  if (html.siteName) names.add(html.siteName, 1, "og:site_name");
  const fromTitle = companyFromTitle(html.title);
  if (fromTitle) names.add(fromTitle, 1, "page title");
  for (const l of html.logoCandidates ?? []) {
    if (logos.some((x) => x.src === l.src)) continue;
    logos.push({ kind: "mark", src: l.src, evidence: l.evidence ? `${l.evidence}${l.alt ? ` (alt "${l.alt.slice(0, 40)}")` : ""}` : `<img> ${l.alt ? `alt="${l.alt.slice(0, 40)}"` : "named logo"}` });
  }
  const icon = html.icons?.[0];
  if (icon && !logos.some((x) => x.kind === "favicon")) logos.push({ kind: "favicon", src: icon, evidence: '<link rel="icon">' });

  return {
    source: dembrandt ? "dembrandt" : "html_css",
    palette: palette.list(24),
    radius: radius.list(10),
    headline: headline.list(8),
    body: body.list(8),
    companyName: names.list(5),
    logos: logos.slice(0, 6),
    description: html.description ?? null,
  };
}

/** Record the model pass's choices as hints/names on the candidates (never new values). */
export function applyModelHints(
  c: BrandCandidates,
  m: { roles: Partial<Record<ColorRole, string | null>>; colorNames?: Record<string, string>; headline?: string | null; body?: string | null; radius?: string | null; companyName?: string | null },
): BrandCandidates {
  const hint = (list: Candidate[], value: string | null | undefined, role: HintRole) => {
    const hit = value ? list.find((x) => x.value.toLowerCase() === value.toLowerCase()) : undefined;
    if (hit && !hit.hints.some((h) => h.role === role && h.by === "model")) {
      hit.hints.push({ role, by: "model" });
      hit.evidence.push(`model: ${role}`);
    }
  };
  for (const [role, hex] of Object.entries(m.roles) as [ColorRole, string | null][]) hint(c.palette, normaliseHex(hex ?? ""), role);
  for (const [hex, name] of Object.entries(m.colorNames ?? {})) {
    const hit = c.palette.find((x) => x.value === normaliseHex(hex));
    if (hit && name) hit.name = name.slice(0, 40);
  }
  hint(c.headline, m.headline, "headline");
  hint(c.body, m.body, "body");
  hint(c.radius, m.radius, "radius");
  if (m.companyName) {
    const hit = c.companyName.find((x) => x.value.toLowerCase() === m.companyName!.toLowerCase());
    if (hit) hit.hints.push({ role: "name", by: "model" });
    else c.companyName.unshift({ value: m.companyName.slice(0, 80), count: 1, evidence: ["model: company name from page copy"], hints: [{ role: "name", by: "model" }] });
  }
  return c;
}
