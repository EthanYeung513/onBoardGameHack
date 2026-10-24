import { discover } from "@/lib/crawl/discover";
import { fetchPage } from "@/lib/crawl/fetch";
import { screenshot } from "@/lib/crawl/cloudflare";
import type { StageContext, StageDefinition, SliceResult } from "../types";

// Crawl in slices: discover URLs, fetch pages a batch at a time, then capture screenshots.
// Every write is an upsert keyed by (project, url), so a resumed slice repeats work safely.

const PAGE_BATCH = 6;
/** Browser fallbacks allowed per crawl; the free Cloudflare plan has about ten browser minutes a day. */
export const MAX_BROWSER_FETCHES = 4;
const MAX_SCREENSHOTS = 5;
const SCREENSHOT_TYPES = ["home", "product", "features", "pricing", "docs", "about"];

type Cursor = { phase?: "discover" | "fetch" | "screens" | "done"; total?: number };

async function copyCachedCrawl(ctx: StageContext, fromId: string): Promise<SliceResult> {
  const { db, project } = ctx;
  const pages = await db.from("crawl_pages").select("url, title, markdown, page_type, rank_score, word_count, content_hash, fetched_at, status").eq("project_id", fromId);
  if (pages.error) throw new Error(pages.error.message);
  const rows = (pages.data ?? []).map((p) => ({ ...p, project_id: project.id, fetch_method: "cache" }));
  if (rows.length) {
    const up = await db.from("crawl_pages").upsert(rows, { onConflict: "project_id,url" });
    if (up.error) throw new Error(up.error.message);
  }
  const assets = await db.from("assets").select("kind, storage_path, source_url, meta").eq("project_id", fromId);
  if (assets.data?.length) {
    await db.from("assets").upsert(
      assets.data.map((a) => ({ ...a, project_id: project.id })),
      { onConflict: "project_id,kind,source_url" },
    );
  }
  await ctx.event("info", `Reused cached crawl: ${rows.length} pages and ${assets.data?.length ?? 0} assets, no browser time used`, { from: fromId });
  return { done: true, summary: `${rows.length} cached pages` };
}

async function discoverPhase(ctx: StageContext): Promise<SliceResult> {
  const { db, project } = ctx;
  await ctx.event("info", `Fetching homepage ${project.url}`);
  const home = await fetchPage(project.url);
  await ctx.event("info", `Homepage fetched via ${home.fetchMethod} (${home.words} words)`, { title: home.title });
  if (!project.name && home.title) await db.from("projects").update({ name: home.title.split(/[|\-–—:]/)[0].trim().slice(0, 80) }).eq("id", project.id);

  const d = await discover(project.url, home.parsed?.links ?? []);
  await ctx.event("info", `Discovered ${d.candidates} URLs, kept the top ${d.ranked.length}`, { sources: d.sources });
  const rows = d.ranked.map((r) => ({ project_id: project.id, url: r.url, page_type: r.pageType, rank_score: r.score, status: "pending" }));
  const up = await db.from("crawl_pages").upsert(rows, { onConflict: "project_id,url", ignoreDuplicates: true });
  if (up.error) throw new Error(up.error.message);
  // Store the homepage result immediately so it is not fetched twice.
  await db
    .from("crawl_pages")
    .update({ title: home.title, markdown: home.markdown, word_count: home.words, content_hash: home.contentHash, fetch_method: home.fetchMethod, status: "fetched", fetched_at: new Date().toISOString() })
    .eq("project_id", project.id)
    .eq("url", d.ranked[0]?.url ?? project.url);
  return { done: false, cursor: { phase: "fetch", total: rows.length }, progress: 0.1 };
}

async function fetchPhase(ctx: StageContext, cursor: Cursor): Promise<SliceResult> {
  const { db, project } = ctx;
  const pending = await db.from("crawl_pages").select("id, url").eq("project_id", project.id).eq("status", "pending").order("rank_score", { ascending: false }).limit(PAGE_BATCH);
  if (pending.error) throw new Error(pending.error.message);
  const { count: browserUsed } = await db.from("crawl_pages").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("fetch_method", "browser");
  let browserLeft = MAX_BROWSER_FETCHES - (browserUsed ?? 0);
  for (const row of pending.data ?? []) {
    if (ctx.remainingMs() < 12_000) break;
    try {
      const p = await fetchPage(row.url, { allowBrowser: browserLeft > 0 });
      if (p.fetchMethod === "browser") browserLeft--;
      await db.from("crawl_pages").update({ title: p.title, markdown: p.markdown, word_count: p.words, content_hash: p.contentHash, fetch_method: p.fetchMethod, status: "fetched", fetched_at: new Date().toISOString(), error: null }).eq("id", row.id);
      await ctx.event(p.fetchMethod === "browser" ? "warn" : "info", `Fetched ${row.url} via ${p.fetchMethod} (${p.words} words)`, { method: p.fetchMethod });
    } catch (err) {
      await db.from("crawl_pages").update({ status: "failed", error: (err as Error).message.slice(0, 300) }).eq("id", row.id);
      await ctx.event("warn", `Could not fetch ${row.url}: ${(err as Error).message}`);
    }
  }
  const { count: left } = await db.from("crawl_pages").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "pending");
  const total = cursor.total ?? 1;
  const progress = 0.1 + 0.7 * (1 - (left ?? 0) / total);
  if ((left ?? 0) > 0) return { done: false, cursor: { ...cursor, phase: "fetch" }, progress };
  return { done: false, cursor: { ...cursor, phase: "screens" }, progress: 0.8 };
}

async function screensPhase(ctx: StageContext): Promise<SliceResult> {
  const { db, project } = ctx;
  const pages = await db.from("crawl_pages").select("url, page_type").eq("project_id", project.id).eq("status", "fetched").order("rank_score", { ascending: false });
  const have = await db.from("assets").select("source_url").eq("project_id", project.id).eq("kind", "screenshot");
  const done = new Set((have.data ?? []).map((a) => a.source_url));
  const picks: string[] = [];
  const seenTypes = new Set<string>();
  for (const t of SCREENSHOT_TYPES) {
    const p = (pages.data ?? []).find((x) => x.page_type === t && !seenTypes.has(t));
    if (p) {
      picks.push(p.url);
      seenTypes.add(t);
    }
  }
  for (const url of picks.slice(0, MAX_SCREENSHOTS)) {
    if (done.has(url)) continue;
    if (ctx.remainingMs() < 15_000) return { done: false, cursor: { phase: "screens" }, progress: 0.9 };
    try {
      const img = await screenshot(url);
      const path = `${project.id}/${Buffer.from(url).toString("base64url").slice(0, 80)}.jpg`;
      const up = await db.storage.from("screenshots").upload(path, img, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw new Error(up.error.message);
      await db.from("assets").upsert({ project_id: project.id, kind: "screenshot", storage_path: path, source_url: url, meta: { bytes: img.byteLength } }, { onConflict: "project_id,kind,source_url" });
      await ctx.event("info", `Screenshot of ${url} stored (${Math.round(img.byteLength / 1024)} KB)`);
    } catch (err) {
      await ctx.event("warn", `Screenshot of ${url} failed: ${(err as Error).message}`);
    }
  }
  const { count } = await db.from("crawl_pages").select("id", { count: "exact", head: true }).eq("project_id", project.id).eq("status", "fetched");
  return { done: true, summary: `${count ?? 0} pages fetched` };
}

export const crawlStage: StageDefinition = {
  name: "crawl",
  label: "Crawl",
  description: "Discover and fetch the most useful pages, then capture screenshots",
  maxAttempts: 3,
  async run(ctx) {
    if (ctx.project.reused_crawl_from) return copyCachedCrawl(ctx, ctx.project.reused_crawl_from);
    const cursor = ctx.job.cursor as Cursor;
    switch (cursor.phase ?? "discover") {
      case "discover":
        return discoverPhase(ctx);
      case "fetch":
        return fetchPhase(ctx, cursor);
      default:
        return screensPhase(ctx);
    }
  },
};
