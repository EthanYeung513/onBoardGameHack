// Usage: npm run fetch:ace-attorney [-- --force]
// Downloads the Ace Attorney sprites, backgrounds and shout graphics listed in src/games/dilemma/ace-attorney.json
// from the Ace Attorney Wiki into public/games/ace-attorney/. The wiki's CDN rate-limits bursts, so requests are
// paced and retried. Files already downloaded are skipped unless --force is given.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, "src/games/dilemma/ace-attorney.json"), "utf8"));
const outDir = path.join(root, "public/games/ace-attorney");
const force = process.argv.includes("--force");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Must match `assetFile` in src/games/dilemma/sprites.ts. */
export const assetFile = (title) => title.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/-+(\.\w+)$/, "$1").replace(/^-+/, "");

const titles = new Set([
  ...Object.values(manifest.backgrounds),
  ...Object.values(manifest.shouts),
  ...Object.values(manifest.characters).flatMap((c) => [...Object.values(c.moods), ...Object.values(c.poses ?? {})].flat()),
]);

async function urlOf(title) {
  const api = `https://aceattorney.fandom.com/api.php?action=query&prop=imageinfo&iiprop=url&format=json&titles=${encodeURIComponent(`File:${title}`)}`;
  const page = Object.values((await (await fetch(api, { headers: { "user-agent": UA } })).json()).query.pages)[0];
  return page.imageinfo?.[0]?.url ?? null;
}

mkdirSync(outDir, { recursive: true });
let fetched = 0;
const failed = [];
for (const title of titles) {
  const file = path.join(outDir, assetFile(title));
  if (existsSync(file) && !force) continue;
  const url = await urlOf(title);
  if (!url) {
    failed.push(`${title} (not on the wiki)`);
    continue;
  }
  let ok = false;
  for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
    // format=original keeps the GIF animation instead of the CDN's WebP re-encode.
    const res = await fetch(`${url}&format=original`, { headers: { "user-agent": UA, accept: "image/gif,image/png,image/*;q=0.8,*/*;q=0.5", referer: "https://aceattorney.fandom.com/" } });
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      ok = true;
      fetched++;
      process.stdout.write(`\r${fetched} downloaded`);
    } else {
      await sleep(1500 * attempt);
    }
  }
  if (!ok) failed.push(title);
  await sleep(600);
}
console.log(`\n${fetched} downloaded, ${titles.size - fetched - failed.length} already present, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
