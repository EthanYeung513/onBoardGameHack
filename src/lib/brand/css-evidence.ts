import { normaliseCandidates, normaliseFont, normaliseRadius } from "./normalise";
import { toHex } from "./colormath";
import type { BrandCandidates } from "./types";

// Brand candidates with *where found* from raw CSS: resolves custom properties, and records the
// selector context each colour / radius / font is used in (buttons, links, headings, body) and
// the variable it came through. Pure: the caller fetches HTML + stylesheets. Used by the replay
// recorder (scripts/brand-record.ts); extract_design can feed its CSS through it too.

const COLOR_RE = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\([^)]*\)/gi;
const COLOR_PROPS = /^(color|background|background-color|border-color|border|fill|stroke|outline-color|text-decoration-color)$/;

function contexts(selector: string): string[] {
  const s = selector.toLowerCase();
  const out: string[] = [];
  if (/button|btn|cta|\[type=.?submit/.test(s)) out.push("role:button");
  if (/(^|[\s,>+~])a([\s:.,[>]|$)|link/.test(s)) out.push("role:link");
  if (/(^|[\s,>])h[12]\b|heading|headline|display|title|hero/.test(s)) out.push("context:heading");
  if (/(^|[\s,])(body|html|p)([\s,:.{]|$)/.test(s)) out.push("context:body");
  if (/logo|brand/.test(s)) out.push("role:logo");
  return out;
}

export function candidatesFromCss(css: string, opts: { themeColor?: string | null } = {}): BrandCandidates {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim());

  // Resolve var(--x, fallback) chains; returns the value and the variable names it went through.
  const resolve = (value: string, depth = 0): { value: string; via: string[] } => {
    const via: string[] = [];
    let out = value;
    for (let i = 0; i < 6 && out.includes("var("); i++) {
      out = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name: string, fb?: string) => {
        via.push(name);
        return vars.get(name) ?? fb ?? "";
      });
    }
    return depth > 6 ? { value: "", via } : { value: out, via };
  };

  const colors: Record<string, unknown>[] = [];
  const radii: Record<string, unknown>[] = [];
  const fonts: Record<string, unknown>[] = [];
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[1].trim();
    if (selector.startsWith("@")) continue;
    const where = contexts(selector);
    for (const decl of rule[2].split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      if (prop.startsWith("--")) continue;
      const { value, via } = resolve(decl.slice(i + 1).trim());
      const tags = [...where, ...via.slice(0, 1).map((v) => `css-var:${v}`)];
      if (COLOR_PROPS.test(prop)) for (const c of value.match(COLOR_RE) ?? []) colors.push({ hex: toHex(c), usage: 1, where: tags });
      else if (prop === "border-radius") radii.push({ value: normaliseRadius(value), usage: 1, where: tags });
      else if (prop === "font-family" || prop === "font") {
        const family = prop === "font" ? value.split(/\s(?=["'a-z])/i).slice(-1)[0] : value;
        fonts.push({ family: normaliseFont(family), usage: 1, where: tags });
      }
    }
  }
  // Variables named like brand tokens count even when the page only uses them indirectly.
  for (const [name, raw] of vars) {
    const hex = toHex(resolve(raw).value);
    if (hex && /brand|primary|accent|secondary|cta|highlight/i.test(name)) colors.push({ hex, usage: 0, where: [`css-var:${name}`] });
  }
  if (opts.themeColor) colors.push({ hex: toHex(opts.themeColor), usage: 1, where: ["theme-color"] });
  return normaliseCandidates({ colors: colors.filter((c) => c.hex), radii: radii.filter((r) => r.value), fonts: fonts.filter((f) => f.family) });
}
