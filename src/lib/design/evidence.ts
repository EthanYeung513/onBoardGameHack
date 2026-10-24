import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fetchText } from "@/lib/crawl/fetch";
import { parseHtml } from "@/lib/crawl/html";

// Raw brand evidence gathered before the model normalises it into DesignTokens.
// dembrandt needs a local Chromium, so it runs only where DEMBRANDT_ENABLED is set (local and CI).
// Elsewhere, including Vercel, colours, fonts and radii are read from the HTML and CSS.

function dembrandtBin(): string | null {
  const p = path.join(process.cwd(), "node_modules", "dembrandt", "dist", "index.js");
  return existsSync(p) ? p : null;
}

export function dembrandtAvailable(): boolean {
  return ["1", "true"].includes((process.env.DEMBRANDT_ENABLED ?? "").toLowerCase()) && dembrandtBin() !== null;
}

export async function runDembrandt(url: string, timeoutMs = 90_000): Promise<Record<string, unknown>> {
  const bin = dembrandtBin();
  if (!bin) throw new Error("dembrandt is not installed");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, url, "--json-only"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`dembrandt timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`dembrandt exited ${code}: ${err.slice(-300)}`));
      try {
        resolve(JSON.parse(out.slice(out.indexOf("{"))));
      } catch (e) {
        reject(new Error(`dembrandt output was not JSON: ${(e as Error).message}`));
      }
    });
  });
}

/** Keeps the parts of dembrandt output that matter for theming, to stay well inside the prompt. */
export function summariseDembrandt(d: Record<string, unknown>): Record<string, unknown> {
  const colors = (d.colors ?? {}) as Record<string, unknown>;
  const palette = ((colors.palette as Array<Record<string, unknown>>) ?? []).slice(0, 14).map((c) => ({
    hex: c.normalized,
    count: c.count,
    role: c.role,
    confidence: c.confidence,
    tokens: (c.tokens as string[] | undefined)?.slice(0, 3),
  }));
  const typo = ((d.typography as { styles?: Array<Record<string, unknown>> })?.styles ?? [])
    .slice(0, 12)
    .map((s) => ({ context: s.context, family: s.family, fallbacks: s.fallbacks, size: s.size, weight: s.weight }));
  const radii = ((d.borderRadius as { values?: Array<Record<string, unknown>> })?.values ?? []).slice(0, 8).map((r) => ({ value: r.value, count: r.count }));
  const spacing = (d.spacing as { scaleType?: string })?.scaleType;
  const shadows = ((d.shadows as Array<Record<string, unknown>>) ?? []).slice(0, 4).map((s) => s.shadow);
  const logo = d.logo as Record<string, unknown> | undefined;
  return {
    siteName: d.siteName,
    semantic: colors.semantic,
    palette,
    typography: typo,
    radii,
    spacing,
    shadows,
    logo: logo ? { url: logo.url, alt: logo.alt, type: logo.type } : null,
  };
}

const COLOR_RE = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/gi;

export function toHex(c: string): string | null {
  if (c.startsWith("#")) {
    const h = c.slice(1).toLowerCase();
    return `#${h.length === 3 ? h.split("").map((x) => x + x).join("") : h}`;
  }
  const m = c.match(/\d+(\.\d+)?/g);
  if (!m || m.length < 3) return null;
  if (m.length === 4 && Number(m[3]) < 0.5) return null;
  return `#${m
    .slice(0, 3)
    .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function htmlCssEvidence(url: string): Promise<Record<string, unknown>> {
  const page = await fetchText(url);
  const parsed = parseHtml(page.text, page.finalUrl);
  let css = parsed.inlineCss;
  for (const sheet of parsed.stylesheets.slice(0, 4)) {
    try {
      const r = await fetchText(sheet, 10_000);
      if (r.status < 400) css += `\n${r.text.slice(0, 400_000)}`;
    } catch {
      // Unreachable stylesheets are skipped.
    }
  }
  const counts = new Map<string, number>();
  for (const m of css.matchAll(COLOR_RE)) {
    const hex = toHex(m[0]);
    if (hex) counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+)[;}]/g)) {
    if (Object.keys(vars).length >= 60) break;
    if (/color|brand|primary|accent|bg|background|text|font|radius/i.test(m[1])) vars[m[1]] = m[2].trim().slice(0, 80);
  }
  const fonts = new Map<string, number>();
  for (const m of css.matchAll(/font-family\s*:\s*([^;}{]+)/gi)) {
    const f = m[1].trim().slice(0, 120);
    fonts.set(f, (fonts.get(f) ?? 0) + 1);
  }
  const radii = new Map<string, number>();
  for (const m of css.matchAll(/border-radius\s*:\s*([^;}{]+)/gi)) radii.set(m[1].trim(), (radii.get(m[1].trim()) ?? 0) + 1);
  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count }));
  return {
    title: parsed.title,
    themeColor: parsed.meta["theme-color"] ?? null,
    ogImage: parsed.meta["og:image"] ?? null,
    colors: top(counts, 20),
    cssVariables: vars,
    fonts: top(fonts, 8),
    googleFonts: parsed.stylesheets.filter((s) => s.includes("fonts.googleapis.com")),
    radii: top(radii, 8),
    logoCandidates: parsed.images.filter((i) => /logo|brand|wordmark/i.test(`${i.src} ${i.alt}`)).slice(0, 5),
    icons: parsed.icons.slice(0, 4),
  };
}
