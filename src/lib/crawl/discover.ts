import * as cheerio from "cheerio";
import { fetchText } from "./fetch";
import { normaliseUrl, rankUrls, sameSite, type RankedUrl } from "./rank";

export interface Discovery {
  root: string;
  sources: Record<"robots" | "sitemap" | "llms" | "links", number>;
  candidates: number;
  ranked: RankedUrl[];
}

async function tryText(url: string): Promise<string | null> {
  try {
    const r = await fetchText(url, 10_000);
    return r.status < 400 ? r.text : null;
  } catch {
    return null;
  }
}

async function readSitemap(url: string, depth = 0): Promise<string[]> {
  const xml = await tryText(url);
  if (!xml || !xml.includes("<")) return [];
  const $ = cheerio.load(xml, { xml: true });
  const nested = $("sitemap > loc").map((_, el) => $(el).text().trim()).get();
  const pages = $("url > loc").map((_, el) => $(el).text().trim()).get();
  if (depth < 1) {
    // Follow at most five nested sitemaps to stay economical.
    for (const n of nested.slice(0, 5)) pages.push(...(await readSitemap(n, depth + 1)));
  }
  return pages;
}

export async function discover(inputUrl: string, homepageLinks: string[] = []): Promise<Discovery> {
  const root = normaliseUrl(inputUrl) ?? inputUrl;
  const origin = new URL(root).origin;
  const sources = { robots: 0, sitemap: 0, llms: 0, links: 0 };
  const found: string[] = [];

  const robots = await tryText(`${origin}/robots.txt`);
  const sitemapUrls = new Set<string>([`${origin}/sitemap.xml`]);
  if (robots) {
    for (const m of robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)) sitemapUrls.add(m[1]);
    sources.robots = sitemapUrls.size - 1;
  }
  for (const s of sitemapUrls) {
    const pages = await readSitemap(s);
    sources.sitemap += pages.length;
    found.push(...pages);
  }

  const llms = await tryText(`${origin}/llms.txt`);
  if (llms && !/<html/i.test(llms)) {
    const urls = [...llms.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]).filter((u) => sameSite(u, root));
    sources.llms = urls.length;
    found.push(...urls.map((u) => u.replace(/\.md$/, "")));
  }

  sources.links = homepageLinks.length;
  found.push(...homepageLinks);

  return { root, sources, candidates: new Set(found).size, ranked: rankUrls(found, root, undefined, homepageLinks) };
}
