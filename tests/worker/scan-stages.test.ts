import { describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { buildCandidates } from "@/lib/brand/candidates";
import { pickBrandTokens } from "@/lib/brand/pick";
import type { FetchedPage } from "@/lib/crawl/fetch";
import { BRAND_NORMALISE_SYSTEM_PROMPT, SCAN_ANALYSE_SYSTEM_PROMPT } from "@/lib/prompts";
import { createEmbedder } from "@/worker/providers/embed";
import { createLlm, type Llm } from "@/worker/providers/llm";
import { analyseStage, OFFLINE_FINDINGS_LABEL } from "@/worker/stages/analyse";
import { createCrawlStage, FETCH_CONCURRENCY, type CrawlCursor, type CrawlDeps } from "@/worker/stages/crawl";
import { createExtractDesignStage, OFFLINE_VOICE } from "@/worker/stages/extract-design";
import type { StageContext } from "@/worker/types";

type Call = { fn: string; args: Record<string, unknown> };

/** A StageContext whose Convex calls are recorded and answered by `answers[fnName]`. */
function fakeCtx(opts: { cursor?: unknown; findings?: unknown; llm?: Llm; answers?: Record<string, unknown>; remaining?: () => number }) {
  const calls: Call[] = [];
  const events: string[] = [];
  const data: (Record<string, unknown> | undefined)[] = [];
  const answer = (fn: unknown, args: Record<string, unknown>) => {
    const name = getFunctionName(fn as never);
    calls.push({ fn: name, args });
    const a = opts.answers?.[name];
    return typeof a === "function" ? a(args) : (a ?? null);
  };
  const ctx = {
    job: { _id: "j1", cursor: opts.cursor ?? {} },
    space: { _id: "s1", name: "Acme", host: "acme.com" },
    scan: { _id: "scan1", url: "https://acme.com", findings: opts.findings },
    connector: null,
    convex: { query: async (fn: unknown, args: Record<string, unknown>) => answer(fn, args), mutation: async (fn: unknown, args: Record<string, unknown>) => answer(fn, args) },
    llm: opts.llm ?? createLlm(),
    embed: createEmbedder(),
    remainingMs: opts.remaining ?? (() => 40_000),
    lost: () => false,
    event: async (_l: string, m: string, d?: Record<string, unknown>) => void (events.push(m), data.push(d)),
    progress: async () => undefined,
  } as unknown as StageContext;
  return { ctx, calls, events, data };
}

const page = (url: string, words = 120): FetchedPage => ({
  url,
  finalUrl: url,
  title: `Title ${url}`,
  markdown: `Content of ${url} `.repeat(words / 4),
  contentHash: `h-${url}`,
  fetchMethod: "http",
  parsed: null,
  html: null,
  words,
});

function crawlDeps(fail: Record<string, string> = {}): CrawlDeps & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    fetched,
    fetchPage: vi.fn(async (url: string) => {
      fetched.push(url);
      if (fail[url]) throw new Error(fail[url]);
      return page(url);
    }) as never,
    discover: vi.fn() as never,
    screenshot: vi.fn() as never,
    storeBytes: vi.fn() as never,
    ingestDocument: vi.fn(async () => ({})) as never,
    browserKeyed: () => false,
  };
}

const urls = ["https://acme.com/", "https://acme.com/about", "https://acme.com/pricing", "https://acme.com/careers"];
const cursor = (done: string[]): CrawlCursor => ({
  phase: "fetch",
  startedAt: 1,
  connectorId: "c1" as never,
  urls: urls.map((url) => ({ url, pageType: "other" })),
  done,
  failed: [],
  browserUsed: 0,
  shots: [],
});

describe("crawl stage", () => {
  it("a resumed slice skips URLs the cursor marks done, and ingests each page into the website connector", async () => {
    const deps = crawlDeps();
    const { ctx, calls } = fakeCtx({ cursor: cursor([urls[0], urls[1]]) });
    const r = await createCrawlStage(deps).run(ctx);
    expect(deps.fetched).toEqual([urls[2], urls[3]]);
    expect(r).toMatchObject({ done: false, cursor: { phase: "screens", done: urls } });
    expect(calls.filter((c) => c.fn === "scanWorker:upsertCrawlPage").map((c) => c.args.url)).toEqual([urls[2], urls[3]]);
    expect(deps.ingestDocument).toHaveBeenCalledWith(ctx, expect.objectContaining({ connectorId: "c1", kind: "page", externalId: urls[2] }));
  });

  it("stops before the slice budget runs out and hands back a cursor to continue from", async () => {
    const deps = crawlDeps();
    let left = 40_000;
    const { ctx } = fakeCtx({ cursor: cursor([urls[0]]), remaining: () => (left -= 15_000) });
    const r = await createCrawlStage(deps).run(ctx);
    expect(deps.fetched).toEqual([urls[1]]);
    expect(r).toMatchObject({ done: false, cursor: { phase: "fetch", done: [urls[0], urls[1]] } });
  });

  it("sweeps removed pages only after a clean crawl; a transient failure keeps earlier copies", async () => {
    const finish = (failed: CrawlCursor["failed"]) => ({ ...cursor(urls), phase: "finish" as const, failed });
    const answers = { "ingest:sweepRemoved": { removed: 2 }, "scanWorker:finishCrawl": 4 };
    let f = fakeCtx({ cursor: finish([{ url: "https://acme.com/old", error: "HTTP 404", gone: true }]), answers });
    expect(await createCrawlStage(crawlDeps()).run(f.ctx)).toMatchObject({ done: true, summary: "4 pages read from acme.com" });
    expect(f.calls.find((c) => c.fn === "ingest:sweepRemoved")?.args).toMatchObject({ connectorId: "c1", before: 1 });
    expect(f.events).toContain("2 pages gone since the last scan");

    f = fakeCtx({ cursor: finish([{ url: urls[1], error: "timeout", gone: false }]), answers });
    await createCrawlStage(crawlDeps()).run(f.ctx);
    expect(f.calls.some((c) => c.fn === "ingest:sweepRemoved")).toBe(false);
    expect(f.calls.find((c) => c.fn === "scanWorker:finishCrawl")?.args.removed).toBe(0);
  });

  it("fetches pages in a bounded parallel pool and reports the re-scan diff (only changed pages re-learn)", async () => {
    const many = Array.from({ length: 14 }, (_, i) => `https://acme.com/p${i}`);
    let inFlight = 0;
    let peak = 0;
    const deps = crawlDeps();
    deps.fetchPage = vi.fn(async (url: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return page(url);
    }) as never;
    const statuses = ["unchanged", "changed", "added"] as const;
    deps.ingestDocument = vi.fn(async (_ctx: unknown, doc: { externalId: string }) => ({ status: statuses[Number(doc.externalId.slice(-1)) % 3] })) as never;
    const { ctx, events } = fakeCtx({ cursor: { ...cursor([]), urls: many.map((url) => ({ url, pageType: "other" })) } });
    const r = await createCrawlStage(deps).run(ctx);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(FETCH_CONCURRENCY);
    expect(r).toMatchObject({ done: false, cursor: { phase: "screens" } });
    expect(events.filter((e) => e.startsWith("Read /p"))).toHaveLength(14);
    expect(events.some((e) => e.includes("unchanged — skipped re-learning"))).toBe(true);
    expect(events.at(-1)).toMatch(/^Since the last scan: \d+ new, \d+ changed, \d+ unchanged/);
  });

  it("narrates discovery with real numbers in the mockup's scan-line shape", async () => {
    const deps = crawlDeps();
    deps.discover = vi.fn(async () => ({
      root: urls[0],
      sources: { robots: 1, sitemap: 1234, llms: 0, links: 10 },
      candidates: 1240,
      ranked: [{ url: urls[0], score: 100, pageType: "home" }, { url: urls[1], score: 40, pageType: "about" }, { url: urls[3], score: 30, pageType: "careers" }],
    })) as never;
    const { ctx, events, data } = fakeCtx({ answers: { "ingest:ensureConnector": "c1" } });
    const r = await createCrawlStage(deps).run(ctx);
    expect(events).toEqual(["Resolving acme.com", "Found 1,234 pages via sitemap.xml", "Reading public pages — about, careers"]);
    // The scan screen reads `data.pages` from crawl events (pipeline.scanStatus).
    expect(data.map((d) => d?.pages ?? null)).toEqual([null, 1234, null]);
    expect(r).toMatchObject({ done: false, cursor: { phase: "fetch", done: [urls[0]] } });
  });
});

const stripeLike = {
  colors: {
    semantic: { primary: "rgb(83, 58, 253)", accent: "rgb(255, 97, 24)", background: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)" },
    palette: [
      { normalized: "#061b31", count: 261, sources: ["hds-heading"] },
      { normalized: "#533afd", count: 80, sources: ["hds-button"] },
      { normalized: "#ffffff", count: 120, sources: [] },
      { normalized: "#ff6118", count: 9, sources: [] },
      { normalized: "#e2e4ff", count: 30, sources: [] },
    ],
  },
  typography: { styles: [{ context: "heading-1", family: "sohne-var", fallbacks: "SF Pro Display", count: 3, weight: 300 }, { context: "text", family: "sohne-var", count: 13 }] },
  borderRadius: { values: [{ value: "4px", count: 40, elements: ["button"] }, { value: "0px 0px 6px 6px", count: 9 }] },
  siteName: "Stripe",
  logo: { type: "wordmark", inline: true, url: "https://stripe.com/", dataUri: "data:image/svg+xml;utf8,%3Csvg%3E%3C%2Fsvg%3E", color: "#533afd" },
  url: "https://stripe.com/",
};

describe("brand candidates + pickBrandTokens", () => {
  it("keeps every candidate with evidence and picks roles from the site's own semantics", () => {
    const c = buildCandidates({ title: "Stripe | Financial Infrastructure", themeColor: null, colors: [{ value: "#635bff", count: 4 }] }, stripeLike);
    expect(c.palette.find((p) => p.value === "#533afd")?.evidence).toEqual(expect.arrayContaining(["dembrandt semantic primary", "logo colour"]));
    expect(c.palette.some((p) => p.value === "#635bff")).toBe(true);
    const picked = pickBrandTokens(c);
    expect(picked.colors.primary.value).toBe("#533afd");
    expect(picked.colors.accent.value).toBe("#ff6118");
    expect(picked.colors.surface.value).toBe("#ffffff");
    expect(["#061b31", "#000000"]).toContain(picked.colors.text.value);
    expect(picked).toMatchObject({ radius: { value: "4px" }, headline: { value: "sohne-var" }, companyName: { value: "Stripe" } });
  });
});

describe("extract_design stage", () => {
  it("offline: tokens from the site's evidence, labelled quality offline, candidates persisted", async () => {
    const deps = {
      dembrandtAvailable: () => true,
      runDembrandt: vi.fn(async () => stripeLike),
      htmlCssEvidence: vi.fn(async () => ({ title: "Stripe", description: "Financial infrastructure to grow your revenue." })),
      loadImage: vi.fn(async () => ({ bytes: new Uint8Array([1]), contentType: "image/svg+xml", format: "svg" })),
      storeBytes: vi.fn(async () => ({ storageId: "st1" as never, url: "http://convex/st1" })),
    };
    const { ctx, calls, events } = fakeCtx({ answers: { "scanWorker:saveBrandProfile": { tokensVersion: 1 } } });
    const r = await createExtractDesignStage(deps).run(ctx);
    expect(r).toMatchObject({ done: true });
    const saved = calls.find((c) => c.fn === "scanWorker:saveBrandProfile")!.args;
    expect(saved).toMatchObject({ quality: "offline", voice: OFFLINE_VOICE, companyName: "Stripe", radius: "4px" });
    expect(saved.palette).toContainEqual({ role: "primary", hex: "#533afd", name: "Primary" });
    expect(saved.logoRefs).toContainEqual({ kind: "wordmark", url: "http://convex/st1", format: "svg" });
    expect((saved.candidates as { palette: unknown[]; labelledBy: string }).labelledBy).toBe("offline-stand-in");
    expect(events[0]).toBe("Extracting brand identity (logo, colors, typography)");
  });
});

describe("analyse stage", () => {
  const pages = { "scanWorker:listCrawlPages": [{ url: "https://acme.com/about", title: "About", text: "We are Acme." }, { url: "https://acme.com", title: "Acme", text: "# Acme\nAcme helps small shops take card payments online and in person." }] };

  it("offline: a labelled stand-in quoting the homepage, no invented lists", async () => {
    const { ctx, calls } = fakeCtx({ answers: pages });
    expect(await analyseStage.run(ctx)).toMatchObject({ done: true, summary: expect.stringMatching(/^offline stand-in/) });
    const f = calls.find((c) => c.fn === "scanWorker:saveFindings")!.args.findings as Record<string, unknown>;
    expect(f).toMatchObject({ mode: "offline", label: OFFLINE_FINDINGS_LABEL, category: null, features: [], people: [] });
    expect(f.productSummary).toEqual({ text: "Acme helps small shops take card payments online and in person.", sourceUrls: ["https://acme.com"] });
  });

  it("live: a citation to an uncrawled URL goes back to the model, not into the findings", async () => {
    const good = { companyName: "Acme", category: "a payments company", confidence: "high", productSummary: { text: "Payments.", sourceUrls: ["https://acme.com"] }, features: [], audience: [], people: [], terms: [], rituals: [] };
    const bad = { ...good, features: [{ name: "Cards", description: "Card payments", sourceUrls: ["https://elsewhere.com"] }] };
    const reply = (v: unknown) => ({ withResponse: async () => ({ data: { model: "gpt-x", choices: [{ message: { content: JSON.stringify(v) } }] }, response: new Response(null) }) });
    const create = vi.fn().mockReturnValueOnce(reply(bad)).mockReturnValueOnce(reply(good));
    vi.stubEnv("MUBIT_API_KEY", "test-key");
    const { ctx, calls, events } = fakeCtx({ answers: pages, llm: createLlm({ chat: { completions: { create } } } as never) });
    await analyseStage.run(ctx);
    vi.unstubAllEnvs();
    expect(create.mock.calls[0][0].messages[0].content).toBe(SCAN_ANALYSE_SYSTEM_PROMPT);
    expect(create.mock.calls[1][0].messages.at(-1).content).toMatch(/elsewhere\.com is not one of the crawled pages/);
    expect(calls.find((c) => c.fn === "scanWorker:saveFindings")!.args.findings).toMatchObject({ mode: "live", category: "a payments company" });
    expect(events).toContain("We think Acme is a payments company");
  });

  it("skips when the scan already has findings (resume repeats nothing)", async () => {
    const { ctx, calls } = fakeCtx({ findings: { mode: "live" } });
    expect(await analyseStage.run(ctx)).toMatchObject({ done: true });
    expect(calls).toEqual([]);
  });
});

describe("scan system prompts", () => {
  it("stay byte-identical (each is one Mubit task)", () => {
    expect({ scan_brand: BRAND_NORMALISE_SYSTEM_PROMPT, scan_analyse: SCAN_ANALYSE_SYSTEM_PROMPT }).toMatchSnapshot();
  });
});
