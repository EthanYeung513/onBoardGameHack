import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { screenshot } from "@/lib/crawl/cloudflare";
import { discover } from "@/lib/crawl/discover";
import { fetchPage, type FetchedPage } from "@/lib/crawl/fetch";
import { ingestDocument } from "../ingest";
import { storeBytes } from "../storage";
import type { SliceResult, StageContext, StageDefinition } from "../types";

// PRD F4, ported from the legacy src/lib/pipeline/stages/crawl.ts: robots/sitemaps/llms.txt
// discovery → ranked ≤30 URLs → HTTP fetch (Cloudflare browser for thin pages when keyed) →
// ≤5 screenshots. Each page is upserted into `crawl_pages` and ingested into the space's
// `website` connector (so the brain and drift cascade see it). The cursor lists finished URLs,
// so a resumed slice skips them. A clean full crawl then sweeps pages gone since the last scan.

export const MAX_BROWSER_FETCHES = 4;
export const MAX_SCREENSHOTS = 5;
const SCREENSHOT_TYPES = ["home", "product", "features", "pricing", "docs", "about"];
/** Leave room for the slowest single fetch (+ browser fallback) before the slice budget ends. */
const PAGE_RESERVE_MS = 12_000;
/** Pages fetched + ingested at once. Bounded: polite to the site, and Mubit embeds in parallel. */
export const FETCH_CONCURRENCY = 6;

export interface CrawlCursor {
  phase: "discover" | "fetch" | "screens" | "finish";
  startedAt: number;
  connectorId: Id<"connectors">;
  urls: { url: string; pageType: string }[];
  done: string[];
  failed: { url: string; error: string; gone: boolean }[];
  browserUsed: number;
  shots: string[];
  /** Re-scan diff (content hashes): what ingest saw this crawl. */
  changes?: { added: number; changed: number; unchanged: number };
  homeChange?: PageChange;
}

export interface CrawlDeps {
  fetchPage: typeof fetchPage;
  discover: typeof discover;
  screenshot: typeof screenshot;
  storeBytes: typeof storeBytes;
  ingestDocument: typeof ingestDocument;
  browserKeyed: () => boolean;
}

export const browserKeyed = () => process.env.OFFLINE !== "1" && Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_WEB_CRAWLER_API);

const pathOf = (url: string) => new URL(url).pathname || "/";

/** What ingest found for a page: re-scans only send `added`/`changed` pages back through the brain. */
export type PageChange = "added" | "changed" | "unchanged" | "empty";

async function savePage(ctx: StageContext, deps: CrawlDeps, c: CrawlCursor, url: string, page: FetchedPage, pageType: string): Promise<PageChange> {
  await ctx.convex.mutation(api.scanWorker.upsertCrawlPage, { scanId: ctx.scan!._id, url, title: page.title || undefined, text: page.markdown, contentHash: page.contentHash });
  let change: PageChange = "empty";
  if (page.markdown.trim()) {
    const res = await deps.ingestDocument(ctx, {
      connectorId: c.connectorId,
      kind: "page",
      externalId: url,
      url,
      title: page.title || pathOf(url),
      text: page.markdown,
      meta: { pageType, fetchMethod: page.fetchMethod, scanId: ctx.scan!._id },
    });
    change = res.status ?? "added";
  }
  return change;
}

async function discoverPhase(ctx: StageContext, deps: CrawlDeps): Promise<SliceResult> {
  const scan = ctx.scan!;
  const host = new URL(scan.url).host;
  await ctx.event("info", `Resolving ${host}`, { step: "resolve", host });
  const connectorId = await ctx.convex.mutation(api.ingest.ensureConnector, { spaceId: ctx.space._id, type: "website" });
  const home = await deps.fetchPage(scan.url, { allowBrowser: deps.browserKeyed() });
  const d = await deps.discover(scan.url, home.parsed?.links ?? []);
  const via = d.sources.sitemap > 0 ? ["sitemap.xml", d.sources.sitemap] : d.sources.llms > 0 ? ["llms.txt", d.sources.llms] : ["homepage links", d.sources.links];
  await ctx.event("info", `Found ${Number(via[1]).toLocaleString("en-US")} pages via ${via[0]}`, { step: "sitemap", pages: Number(via[1]), via: via[0], sources: d.sources, candidates: d.candidates, kept: d.ranked.length });

  const c: CrawlCursor = {
    phase: "fetch",
    startedAt: Date.now(),
    connectorId,
    urls: d.ranked.map((r) => ({ url: r.url, pageType: r.pageType })),
    done: [],
    failed: [],
    browserUsed: 0,
    shots: [],
  };
  const root = c.urls[0]?.url ?? scan.url;
  if (!c.urls.length) c.urls.push({ url: root, pageType: "home" });
  const homeChange = await savePage(ctx, deps, c, root, home, c.urls[0].pageType);
  if (home.fetchMethod === "browser") c.browserUsed++;
  c.changes = { added: 0, changed: 0, unchanged: 0 };
  if (homeChange !== "empty") c.changes[homeChange]++;
  c.homeChange = homeChange;
  c.done.push(root);

  const types = [...new Set(c.urls.map((u) => u.pageType).filter((t) => t !== "home" && t !== "other"))].slice(0, 4);
  await ctx.event("info", `Reading public pages: ${types.length ? types.join(", ") : "homepage"}`, { step: "read", kept: c.urls.length, types });
  return { done: false, cursor: { ...c }, progress: 0.1 };
}

async function fetchPhase(ctx: StageContext, deps: CrawlDeps, c: CrawlCursor): Promise<SliceResult> {
  const finished = new Set([...c.done, ...c.failed.map((f) => f.url)]);
  const todo = c.urls.filter((u) => !finished.has(u.url));
  const progress = () => 0.1 + 0.7 * ((c.done.length + c.failed.length) / Math.max(1, c.urls.length));
  c.changes ??= { added: 0, changed: 0, unchanged: 0 };
  let next = 0;
  let stop = false;
  // A bounded pool: each lane takes the next URL until the list (or the slice budget) runs out.
  // Every page still reports its own "Read …" line, so the feed moves page by page.
  const lane = async () => {
    while (!stop && next < todo.length) {
      if (ctx.lost() || ctx.remainingMs() < PAGE_RESERVE_MS) {
        stop = true;
        return;
      }
      const { url, pageType } = todo[next++];
      const allowBrowser = deps.browserKeyed() && c.browserUsed < MAX_BROWSER_FETCHES;
      if (allowBrowser) c.browserUsed++; // reserve the slot before the await so lanes can't overshoot
      try {
        const page = await deps.fetchPage(url, { allowBrowser });
        if (allowBrowser && page.fetchMethod !== "browser") c.browserUsed--;
        const change = await savePage(ctx, deps, c, url, page, pageType);
        c.done.push(url);
        if (change !== "empty") c.changes![change]++;
        const note = change === "unchanged" ? ", unchanged, skipped re-learning" : change === "changed" ? ", changed, re-learning" : "";
        await ctx.event("info", `Read ${pathOf(url)} (${page.words} words${page.fetchMethod === "browser" ? ", rendered in a browser" : ""}${note})`, { url, method: page.fetchMethod, pageType, change });
      } catch (err) {
        if (allowBrowser) c.browserUsed--;
        const error = (err as Error).message.slice(0, 300);
        c.failed.push({ url, error, gone: /HTTP (404|410)\b/.test(error) });
        await ctx.event("warn", `Couldn't read ${pathOf(url)}: ${error}`, { url });
      }
      await ctx.progress(progress(), { ...c });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, todo.length) }, lane));
  if (next < todo.length || c.done.length + c.failed.length < c.urls.length) return { done: false, cursor: { ...c }, progress: progress() };
  const { added, changed, unchanged } = c.changes;
  if (changed || unchanged) {
    await ctx.event("info", `Since the last scan: ${added} new, ${changed} changed, ${unchanged} unchanged`, { step: "diff", ...c.changes });
  }
  return { done: false, cursor: { ...c, phase: "screens" }, progress: 0.8 };
}

async function screensPhase(ctx: StageContext, deps: CrawlDeps, c: CrawlCursor): Promise<SliceResult> {
  if (!deps.browserKeyed()) {
    await ctx.event("info", "Page screenshots skipped (Cloudflare Browser Rendering is not configured)", { step: "screens", standIn: true });
    return { done: false, cursor: { ...c, phase: "finish" }, progress: 0.9 };
  }
  const read = c.urls.filter((u) => c.done.includes(u.url));
  const picks: string[] = [];
  for (const t of SCREENSHOT_TYPES) {
    const p = read.find((u) => u.pageType === t);
    if (p) picks.push(p.url);
  }
  for (const url of picks.slice(0, MAX_SCREENSHOTS)) {
    if (c.shots.includes(url)) continue;
    if (ctx.lost() || ctx.remainingMs() < 15_000) return { done: false, cursor: { ...c }, progress: 0.85 };
    try {
      const img = await deps.screenshot(url);
      const { storageId } = await deps.storeBytes(ctx, img, "image/jpeg");
      await ctx.convex.mutation(api.scanWorker.setPageScreenshot, { scanId: ctx.scan!._id, url, storageId });
      await ctx.event("info", `Captured a screenshot of ${pathOf(url)}`, { url, kb: Math.round(img.byteLength / 1024) });
    } catch (err) {
      await ctx.event("warn", `Screenshot of ${pathOf(url)} failed: ${(err as Error).message.slice(0, 200)}`, { url });
    }
    c.shots.push(url);
    await ctx.progress(0.85, { ...c });
  }
  return { done: false, cursor: { ...c, phase: "finish" }, progress: 0.9 };
}

async function finishPhase(ctx: StageContext, c: CrawlCursor): Promise<SliceResult> {
  if (!c.done.length) throw new Error(`No pages could be read from ${ctx.scan!.url}: ${c.failed[0]?.error ?? "nothing to fetch"}`);
  const transient = c.failed.filter((f) => !f.gone);
  let removed = 0;
  if (transient.length) {
    await ctx.event("warn", `Kept earlier copies of ${transient.length} page${transient.length > 1 ? "s" : ""} that failed to load this time`);
  } else {
    ({ removed } = await ctx.convex.mutation(api.ingest.sweepRemoved, { spaceId: ctx.space._id, connectorId: c.connectorId, before: c.startedAt }));
    if (removed) await ctx.event("info", `${removed} page${removed > 1 ? "s" : ""} gone since the last scan`, { removed });
  }
  const changes = c.changes ? { ...c.changes, home: c.homeChange } : undefined;
  const pages = await ctx.convex.mutation(api.scanWorker.finishCrawl, { scanId: ctx.scan!._id, connectorId: c.connectorId, removed, changes });
  return { done: true, summary: `${pages} pages read from ${new URL(ctx.scan!.url).host}` };
}

export function createCrawlStage(deps: CrawlDeps): StageDefinition {
  return {
    name: "crawl",
    maxAttempts: 3,
    async run(ctx) {
      if (!ctx.scan) throw new Error("crawl needs a scan");
      const c = ctx.job.cursor as Partial<CrawlCursor>;
      switch (c.phase ?? "discover") {
        case "discover":
          return discoverPhase(ctx, deps);
        case "fetch":
          return fetchPhase(ctx, deps, c as CrawlCursor);
        case "screens":
          return screensPhase(ctx, deps, c as CrawlCursor);
        default:
          return finishPhase(ctx, c as CrawlCursor);
      }
    },
  };
}

export const crawlStage = createCrawlStage({ fetchPage, discover, screenshot, storeBytes, ingestDocument, browserKeyed });
