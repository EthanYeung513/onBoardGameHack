// Path based ranking for crawl candidates. Pure and deterministic so it can be unit tested.

export const MAX_PAGES = 30;
/** Pages scoring below LOW_SCORE are kept only while the crawl has fewer than MIN_PAGES. */
export const MIN_PAGES = 10;
export const LOW_SCORE = 5;

const HIGH: Array<[RegExp, number, string]> = [
  [/^\/?$/, 100, "home"],
  [/\/(docs?|documentation|guides?|getting-started|quickstart|start)(\/|$)/, 60, "docs"],
  [/\/(product|products|platform|solutions?)(\/|$)/, 55, "product"],
  [/\/(features?|capabilities|how-it-works)(\/|$)/, 55, "features"],
  [/\/(pricing|plans)(\/|$)/, 50, "pricing"],
  [/\/(about|company|team|mission)(\/|$)/, 40, "about"],
  [/\/(careers|jobs)(\/|$)/, 30, "careers"],
  [/\/(changelog|releases|updates|whats-new)(\/|$)/, 30, "changelog"],
  [/\/(customers|case-studies|use-cases)(\/|$)/, 35, "customers"],
  [/\/(integrations?|api)(\/|$)/, 35, "integrations"],
  [/\/(blog|news)(\/|$)/, 10, "blog"],
];

const DROP = [
  /\/(legal|privacy|terms|cookies?|gdpr|dpa|security-policy|imprint|impressum|tos)(\/|$|-)/,
  /\/(tags?|categor(y|ies)|authors?|page\/\d+)(\/|$)/,
  /\/(login|signin|sign-in|signup|sign-up|register|logout|cart|checkout|account|search)(\/|$)/,
  // Per-user and per-member pages: large in number, thin in product content.
  /\/(users?|profiles?|members?|people|u|@[^/]+)(\/|$)/,
  /\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|xml|json|txt|md|css|js|ico)$/i,
  /^\/\.well-known\//,
];

// Two letter language prefixes other than English, such as /de/ or /fr-fr/.
const LANG = /^\/(?!en(\/|$|-))([a-z]{2})(-[a-z]{2})?(\/|$)/i;

export interface RankedUrl {
  url: string;
  score: number;
  pageType: string;
}

export function normaliseUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.search = "";
    let path = u.pathname.replace(/\/{2,}/g, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString();
  } catch {
    return null;
  }
}

export function sameSite(a: string, b: string): boolean {
  const ha = new URL(a).hostname.replace(/^www\./, "");
  const hb = new URL(b).hostname.replace(/^www\./, "");
  return ha === hb;
}

export function classify(url: string): { score: number; pageType: string } | null {
  const path = new URL(url).pathname.toLowerCase();
  if (DROP.some((r) => r.test(path))) return null;
  if (LANG.test(path)) return null;
  let best = { score: 5, pageType: "other" };
  for (const [re, score, type] of HIGH) {
    if (re.test(path) && score > best.score) best = { score, pageType: type };
  }
  // Prefer shallow pages: each extra path segment costs a little.
  const depth = path.split("/").filter(Boolean).length;
  return { score: best.score - Math.max(0, depth - 1) * 4, pageType: best.pageType };
}

/** Pages linked from the homepage get this bonus over pages known only from a sitemap. */
export const HOMEPAGE_LINK_BONUS = 8;

export function rankUrls(urls: string[], root: string, cap = MAX_PAGES, linked: Iterable<string> = []): RankedUrl[] {
  const boosted = new Set<string>();
  for (const l of linked) {
    const n = normaliseUrl(l, root);
    if (n) boosted.add(new URL(n).pathname);
  }
  const seen = new Set<string>();
  const out: RankedUrl[] = [];
  for (const raw of [root, ...urls]) {
    let url = normaliseUrl(raw, root);
    if (!url || !sameSite(url, root)) continue;
    // Collapse www and bare hosts onto the host the user entered.
    const u = new URL(url);
    u.host = new URL(root).host;
    url = u.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const c = classify(url);
    if (!c) continue;
    out.push({ url, pageType: c.pageType, score: c.score + (c.pageType !== "home" && boosted.has(new URL(url).pathname) ? HOMEPAGE_LINK_BONUS : 0) });
  }
  out.sort((a, b) => b.score - a.score || a.url.length - b.url.length || a.url.localeCompare(b.url));
  // Deep pages known only from a sitemap rarely say much about the product; they only fill small crawls.
  return out.filter((r, i) => r.score >= LOW_SCORE || i < MIN_PAGES).slice(0, cap);
}
