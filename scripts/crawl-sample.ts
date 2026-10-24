// Runs discovery, page fetching and one screenshot against a live site and writes the results to
// artifacts/crawl/<host>/ so the crawler can be inspected without the app or a database.
import { mkdir, writeFile } from "node:fs/promises";
import { discover } from "@/lib/crawl/discover";
import { fetchPage } from "@/lib/crawl/fetch";
import { screenshot } from "@/lib/crawl/cloudflare";

const target = process.argv[2] ?? "https://www.mubit.ai";
const limit = Number(process.argv[3] ?? 8);

async function main() {
  const host = new URL(target).hostname;
  const dir = `artifacts/crawl/${host}`;
  await mkdir(`${dir}/pages`, { recursive: true });

  const t0 = Date.now();
  const home = await fetchPage(target);
  console.log(`home  ${home.fetchMethod.padEnd(7)} ${String(home.words).padStart(5)} words  ${home.title}`);
  const d = await discover(target, home.parsed?.links ?? []);
  console.log(`discovery  sources=${JSON.stringify(d.sources)} candidates=${d.candidates} ranked=${d.ranked.length}`);
  for (const r of d.ranked.slice(0, 15)) console.log(`  ${String(r.score).padStart(4)}  ${r.pageType.padEnd(12)} ${r.url}`);

  const rows = [];
  for (const r of d.ranked.slice(0, limit)) {
    try {
      const p = r.url === home.url ? home : await fetchPage(r.url);
      const file = `${dir}/pages/${(new URL(r.url).pathname.replace(/\W+/g, "_") || "_").replace(/^_$/, "home")}.md`;
      await writeFile(file, `# ${p.title}\n\nSource: ${p.finalUrl}\nFetch method: ${p.fetchMethod}\n\n${p.markdown}`);
      rows.push({ url: r.url, type: r.pageType, method: p.fetchMethod, words: p.words, hash: p.contentHash, file });
      console.log(`fetch ${p.fetchMethod.padEnd(7)} ${String(p.words).padStart(5)} words  ${r.url}`);
    } catch (err) {
      rows.push({ url: r.url, type: r.pageType, error: (err as Error).message });
      console.log(`FAIL  ${r.url}  ${(err as Error).message}`);
    }
  }

  let shot: string | null = null;
  try {
    const png = await screenshot(target);
    shot = `${dir}/home.png`;
    await writeFile(shot, png);
    console.log(`screenshot ${png.byteLength} bytes -> ${shot}`);
  } catch (err) {
    console.log(`screenshot FAIL ${(err as Error).message}`);
  }

  await writeFile(`${dir}/summary.json`, JSON.stringify({ target, ms: Date.now() - t0, discovery: d, pages: rows, screenshot: shot }, null, 2));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${dir}/summary.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
