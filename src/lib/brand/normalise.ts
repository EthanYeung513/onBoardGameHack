import { hueName, isHex, isNeutral, toHex } from "./colormath";
import type { BrandCandidates, BrandField, Candidate, CompanyProfile, RawCandidate } from "./types";

// Normalises brand evidence into BrandCandidates. Defensive by design: the extract_design stage
// (scan-stages agent) stores `brand_profiles.candidates` in its own shape, and the HTML/CSS
// fallback and dembrandt summaries (src/lib/design/evidence.ts) differ again. Every reader here
// accepts any of them and ignores what it doesn't understand.

type Loose = Record<string, unknown>;
const arr = (x: unknown): Loose[] => (Array.isArray(x) ? (x.filter((i) => i && typeof i === "object") as Loose[]) : []);
const num = (x: unknown, d = 1) => (typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && x.trim() && !Number.isNaN(Number(x)) ? Number(x) : d);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : typeof x === "string" ? [x] : []);

class Bag {
  private m = new Map<string, RawCandidate>();
  add(value: string | null, usage: number, where: string[]) {
    if (!value) return;
    const cur = this.m.get(value) ?? { value, usage: 0, where: [] };
    cur.usage += Math.max(0, usage);
    for (const w of where) if (w && cur.where.length < 10 && !cur.where.includes(w)) cur.where.push(w);
    this.m.set(value, cur);
  }
  list(): RawCandidate[] {
    return [...this.m.values()];
  }
}

/** `8px`, `.5rem`, `8px 8px 0 0`, `50%`, `9999px` → `Npx` (pills collapse to `999px`). */
export function normaliseRadius(raw: unknown): string | null {
  if (typeof raw === "number") return raw >= 100 ? "999px" : `${Math.round(raw)}px`;
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (!s || s.includes("var(") || s === "inherit" || s === "initial") return null;
  if (/(^|\s)(50|100)%/.test(s)) return "999px";
  const px = [...s.matchAll(/(-?[\d.]+)\s*(px|rem|em)?/g)].map((m) => Number(m[1]) * (m[2] === "rem" || m[2] === "em" ? 16 : 1)).filter((n) => Number.isFinite(n) && n >= 0);
  if (!px.length) return null;
  const v = Math.max(...px);
  return v >= 100 ? "999px" : `${Math.round(v)}px`;
}

export const radiusPx = (v: string) => Number.parseFloat(v) || 0;

const GENERIC = new Set(["sans-serif", "serif", "monospace", "system-ui", "inherit", "initial", "cursive", "fantasy", "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system", "blinkmacsystemfont", "unset"]);

/** First real family from a CSS font-family stack, without quotes; null for generics/vars. */
export function normaliseFont(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  for (const part of raw.split(",")) {
    const f = part.trim().replace(/^["']|["']$/g, "").replace(/!important/i, "").trim();
    if (!f || f.includes("var(") || GENERIC.has(f.toLowerCase()) || !/[a-z]{2}/i.test(f) || /^[-\d.]+(px|r?em|%)?$/i.test(f)) continue;
    return f.slice(0, 60);
  }
  return null;
}

function addWhere(item: Loose): string[] {
  const where = [...strs(item.where), ...strs(item.source), ...strs(item.sources)];
  for (const r of strs(item.role ?? item.roleHint ?? item.roles)) where.push(`role:${r.toLowerCase()}`);
  for (const t of strs(item.tokens)) where.push(`css-var:${t}`);
  for (const c of strs(item.context)) where.push(`context:${c.toLowerCase()}`);
  // scan-stages shape (src/lib/brand/candidates.ts): hints [{ role, by }] + evidence strings.
  for (const h of arr(item.hints)) {
    const role = typeof h.role === "string" ? h.role.toLowerCase() : "";
    if (role === "headline") where.push("context:heading");
    else if (role === "body") where.push("context:body");
    else if (role) where.push(`role:${role === "surface" ? "background" : role}`);
  }
  for (const e of strs(item.evidence)) {
    const v = e.match(/css var (--[\w-]+)/);
    if (v) where.push(`css-var:${v[1]}`);
    else if (/theme-color/.test(e)) where.push("theme-color");
    else if (/logo/.test(e)) where.push("role:logo");
  }
  return where;
}

/** Any stored/evidence shape → BrandCandidates (colors, radii, fonts). */
export function normaliseCandidates(raw: unknown): BrandCandidates {
  const r = (raw && typeof raw === "object" ? raw : {}) as Loose;
  const colors = new Bag();
  const radii = new Bag();
  const fonts = new Bag();

  const colorLists = [r.colors, r.palette, (r.palette as Loose | undefined)?.candidates, r.colorCandidates];
  for (const list of colorLists)
    for (const c of arr(list)) colors.add(toHex(c.hex ?? c.value ?? c.normalized ?? c.color), num(c.usage ?? c.count), addWhere(c));

  const vars = (r.cssVariables && typeof r.cssVariables === "object" ? r.cssVariables : {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(vars)) {
    const hex = toHex(value);
    if (hex) colors.add(hex, 1, [`css-var:${name}`]);
    else if (/radius/i.test(name)) radii.add(normaliseRadius(value), 1, [`css-var:${name}`]);
    else if (/font-?(family|sans|serif|display|heading|body|brand|primary)$|typeface/i.test(name)) fonts.add(normaliseFont(value), 1, [`css-var:${name}`, ...(/head|display|title/i.test(name) ? ["context:heading"] : [])]);
  }
  const theme = toHex(r.themeColor);
  if (theme) colors.add(theme, 1, ["theme-color"]);
  const semantic = (r.semantic && typeof r.semantic === "object" ? r.semantic : {}) as Record<string, unknown>;
  for (const [role, value] of Object.entries(semantic)) colors.add(toHex(value), 1, [`role:${role.toLowerCase()}`]);

  for (const list of [r.radii, r.radius, r.radiusCandidates])
    for (const c of arr(list)) radii.add(normaliseRadius(c.value ?? c.radius ?? c.px), num(c.usage ?? c.count), addWhere(c));

  for (const list of [r.fonts, r.typography, r.headline, r.fontCandidates, r.headlines])
    for (const c of arr(list)) fonts.add(normaliseFont(c.family ?? c.value ?? c.font), num(c.usage ?? c.count), [...addWhere(c), ...(list === r.headline ? ["context:heading"] : [])]);
  for (const c of arr(r.body)) fonts.add(normaliseFont(c.family ?? c.value), num(c.usage ?? c.count), [...addWhere(c), "context:body"]);

  const surface = toHex(r.surface) ?? undefined;
  return { colors: colors.list(), radii: radii.list(), fonts: fonts.list(), surface };
}

/** Candidates from a brand profile that has no stored candidates (palette roles become hints). */
export function candidatesFromProfile(p: {
  palette: { hex: string; role: string }[];
  radius?: string;
  typography: { heading: { family: string }; body: { family: string } };
  candidates?: unknown;
}): BrandCandidates {
  const fromStored = p.candidates ? normaliseCandidates(p.candidates) : null;
  if (fromStored && fromStored.colors.length) return fromStored;
  return normaliseCandidates({
    colors: p.palette.map((c) => ({ hex: c.hex, role: c.role, usage: 1, where: ["brand-profile"] })),
    radii: p.radius ? [{ value: p.radius, where: ["brand-profile"] }] : [],
    fonts: [
      { family: p.typography.heading.family, context: "heading", where: ["brand-profile"] },
      { family: p.typography.body.family, context: "body", where: ["brand-profile"] },
    ],
    surface: p.palette.find((c) => c.role === "surface")?.hex,
  });
}

const prettyWhere = (w: string) =>
  w.startsWith("css-var:") ? `var ${w.slice(8)}` : w.startsWith("role:") ? `${w.slice(5)} role` : w.startsWith("context:") ? `${w.slice(8)} text` : w.replace(/-/g, " ");

export function evidenceText(c: RawCandidate): string {
  const parts = [`seen ${c.usage}×`, ...c.where.slice(0, 3).map(prettyWhere)];
  return parts.join(" · ");
}

/** Raw pool for a field (colours for primary/accent), capped so prompts and the UI stay small. */
export function fieldPool(field: BrandField, c: BrandCandidates, cap = 8): RawCandidate[] {
  const pool = field === "radius" ? c.radii : field === "headline" ? c.fonts : c.colors.filter((x) => isHex(x.value));
  const hinted = (x: RawCandidate) => x.where.some((w) => w.startsWith("css-var:") || w.startsWith("role:") || w === "theme-color" || w.startsWith("context:head"));
  const rankScore = (x: RawCandidate) => Math.log1p(x.usage) + (hinted(x) ? 2 : 0) + (field !== "radius" && field !== "headline" && !isNeutral(x.value) ? 1 : 0);
  return [...pool].sort((a, b) => rankScore(b) - rankScore(a)).slice(0, cap);
}

export const toCandidate = (c: RawCandidate): Candidate => ({ value: c.value, evidence: evidenceText(c) });

export function paletteSummary(c: BrandCandidates): string {
  return fieldPool("primary", c, 6)
    .map((x) => `${hueName(x.value)} ${x.value} ×${x.usage}${x.where.length ? ` (${x.where.slice(0, 2).map(prettyWhere).join(", ")})` : ""}`)
    .join("; ");
}

export function buildCompanyProfile(input: Omit<CompanyProfile, "paletteSummary">, c: BrandCandidates): CompanyProfile {
  return { ...input, host: input.host.replace(/^www\./, "").toLowerCase(), paletteSummary: paletteSummary(c) };
}

/** Text embedded for precedent search: who the company is plus what its palette looks like. */
export function profileText(p: CompanyProfile): string {
  return [p.host, p.name, p.category, p.industry, p.description, p.voice, `palette: ${p.paletteSummary}`].filter(Boolean).join("\n");
}
