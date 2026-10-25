// Records brand evidence for the replay eval: `npm run eval:brand:record -- <url> [category]`.
// Fetches the homepage + stylesheets, extracts candidates with where-found context
// (src/lib/brand/css-evidence.ts) and writes normalised candidates to cases/brand/<host>.json. Existing `decisions`
// (the manager labels the eval replays) are kept when a file is re-recorded.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fetchText } from "@/lib/crawl/fetch";
import { parseHtml } from "@/lib/crawl/html";
import { fieldPool } from "@/lib/brand/normalise";
import { candidatesFromCss } from "@/lib/brand/css-evidence";

async function main() {
  const [url, category] = process.argv.slice(2);
  if (!url) throw new Error("usage: npm run eval:brand:record -- <url> [category]");
  const host = new URL(url).hostname.replace(/^www\./, "");
  const page = await fetchText(url);
  const parsed = parseHtml(page.text, page.finalUrl);
  let css = parsed.inlineCss;
  for (const sheet of parsed.stylesheets.slice(0, 8)) {
    try {
      const r = await fetchText(sheet, 15_000);
      if (r.status < 400) css += `\n${r.text.slice(0, 800_000)}`;
    } catch {
      // Unreachable stylesheets are skipped.
    }
  }
  const c = candidatesFromCss(css, { themeColor: parsed.meta["theme-color"] });
  const trimmed = { colors: fieldPool("primary", c, 12), radii: fieldPool("radius", c, 8), fonts: fieldPool("headline", c, 8), surface: c.surface };
  const file = `cases/brand/${host}.json`;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  mkdirSync("cases/brand", { recursive: true });
  const out = {
    host,
    url,
    name: prev.name ?? String(parsed.title || host).split(/[|–—-]/)[0].trim(),
    category: category ?? prev.category,
    recordedAt: new Date().toISOString(),
    source: "css-evidence",
    candidates: trimmed,
    decisions: prev.decisions ?? {},
  };
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${file}: ${trimmed.colors.length} colours, ${trimmed.radii.length} radii, ${trimmed.fonts.length} fonts`);
  for (const x of trimmed.colors) console.log(`  ${x.value} ×${x.usage} ${x.where.join(" ")}`);
  console.log(`  radii: ${trimmed.radii.map((x) => `${x.value}×${x.usage}`).join(", ")}`);
  console.log(`  fonts: ${trimmed.fonts.map((x) => `${x.value}×${x.usage}`).join(", ")}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
