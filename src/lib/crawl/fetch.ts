import { createHash } from "node:crypto";
import { renderMarkdown } from "./cloudflare";
import { parseHtml, wordCount, type ParsedPage } from "./html";

export const USER_AGENT = "OnboardingGeneratorBot/0.1 (+https://github.com/EthanYeung513/onBoardGameHack)";

/** Below this many words a page is treated as client rendered and sent to the browser. */
export const THIN_PAGE_WORDS = 80;

export interface FetchedPage {
  url: string;
  finalUrl: string;
  title: string;
  markdown: string;
  contentHash: string;
  fetchMethod: "http" | "browser";
  parsed: ParsedPage | null;
  html: string | null;
  words: number;
}

export async function fetchText(url: string, timeoutMs = 15_000): Promise<{ status: number; text: string; finalUrl: string; contentType: string }> {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, text, finalUrl: res.url || url, contentType: res.headers.get("content-type") ?? "" };
}

export function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/** Plain HTTP first; the Cloudflare browser only when the result looks client rendered. */
export async function fetchPage(url: string, opts: { allowBrowser?: boolean } = {}): Promise<FetchedPage> {
  let parsed: ParsedPage | null = null;
  let html: string | null = null;
  let finalUrl = url;
  let httpError: string | null = null;
  try {
    const r = await fetchText(url);
    finalUrl = r.finalUrl;
    if (r.status >= 400) httpError = `HTTP ${r.status}`;
    else if (!r.contentType.includes("html")) httpError = `unsupported content type ${r.contentType}`;
    else {
      html = r.text;
      parsed = parseHtml(r.text, finalUrl);
    }
  } catch (err) {
    httpError = err instanceof Error ? err.message : String(err);
  }

  const words = parsed ? wordCount(parsed.markdown) : 0;
  if (parsed && words >= THIN_PAGE_WORDS) {
    return { url, finalUrl, title: parsed.title, markdown: parsed.markdown, contentHash: hash(parsed.markdown), fetchMethod: "http", parsed, html, words };
  }
  if (opts.allowBrowser === false) {
    if (parsed) return { url, finalUrl, title: parsed.title, markdown: parsed.markdown, contentHash: hash(parsed.markdown), fetchMethod: "http", parsed, html, words };
    throw new Error(`Fetch failed for ${url}: ${httpError}`);
  }
  const md = await renderMarkdown(url);
  const title = parsed?.title || md.match(/^title:\s*"?(.+?)"?$/m)?.[1] || md.match(/^#\s+(.+)$/m)?.[1] || url;
  const body = md.replace(/^---[\s\S]*?---\s*/, "");
  return { url, finalUrl, title, markdown: body, contentHash: hash(body), fetchMethod: "browser", parsed, html, words: wordCount(body) };
}
