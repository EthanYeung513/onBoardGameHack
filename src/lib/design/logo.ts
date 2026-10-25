import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

// Find the company's own logo on its homepage (F5). Ranked, with evidence:
//   1. the home link in the header/nav (`<a href="/">` wrapping an <img>/<svg>) — how almost every
//      site renders its logo;
//   2. <img>/<svg> named logo/brand inside the header/nav;
//   3. alt/aria/title naming the company (+ "logo");
// and penalising customer-logo walls (many logo images in one section) and photos. Inline SVGs
// become data: URIs so they can be stored like any image.

export interface LogoCandidateEvidence {
  src: string;
  alt: string;
  score: number;
  evidence: string;
}

const PHOTO_ALT = /\b(photo|view of|picture of|aerial|portrait|street|exterior|interior|people|team photo|screenshot)\b/i;

function companyTokens(host: string, siteName?: string | null): string[] {
  const base = host.replace(/^www\./, "").split(".")[0];
  const fromName = (siteName ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  return [...new Set([base.toLowerCase(), ...fromName])].filter(Boolean);
}

function isHomeHref(href: string | undefined, pageUrl: URL): boolean {
  if (!href) return false;
  try {
    const u = new URL(href, pageUrl);
    return u.host.replace(/^www\./, "") === pageUrl.host.replace(/^www\./, "") && /^\/?(index\.html?)?$|^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
}

function svgDataUri($: cheerio.CheerioAPI, el: AnyNode): string | null {
  const svg = $(el).clone();
  if (!svg.attr("xmlns")) svg.attr("xmlns", "http://www.w3.org/2000/svg");
  // currentColor logos render black on their own; that's still the right shape.
  const markup = $.html(svg);
  if (!markup || markup.length > 60_000 || markup.length < 80) return null;
  return `data:image/svg+xml;base64,${Buffer.from(markup).toString("base64")}`;
}

export function findLogoCandidates(html: string, pageUrl: string, hints: { siteName?: string | null } = {}): LogoCandidateEvidence[] {
  const $ = cheerio.load(html);
  const url = new URL(pageUrl);
  const tokens = companyTokens(url.host, hints.siteName);
  const named = (s: string) => tokens.some((t) => s.toLowerCase().includes(t));
  const out = new Map<string, LogoCandidateEvidence>();

  const consider = (el: AnyNode, kind: "img" | "svg") => {
    const $el = $(el);
    const src = kind === "img" ? $el.attr("src") || $el.attr("data-src") || "" : svgDataUri($, el) ?? "";
    if (!src || src.startsWith("data:image/gif")) return;
    const abs = kind === "img" ? new URL(src, url).toString() : src;
    const alt = ($el.attr("alt") || $el.attr("aria-label") || $el.find("title").first().text() || $el.closest("a").attr("aria-label") || $el.closest("a").attr("title") || "").trim();
    const cls = `${$el.attr("class") ?? ""} ${$el.attr("id") ?? ""} ${$el.parent().attr("class") ?? ""} ${$el.closest("a").attr("class") ?? ""}`;
    const inHeader = $el.closest("header, nav, [role=banner], [class*=header], [class*=navbar], [class*=nav-]").length > 0;
    const home = isHomeHref($el.closest("a").attr("href"), url);
    const why: string[] = [];
    let score = 0;
    const add = (points: number, reason: string) => {
      score += points;
      why.push(reason);
    };
    if (home && inHeader) add(60, "home link in the header");
    else if (home) add(35, "home link");
    if (inHeader) add(15, "in header/nav");
    if (/logo|brand|wordmark/i.test(`${cls} ${kind === "img" ? src : ""}`)) add(20, "named logo");
    if (named(alt) || (kind === "img" && named(src.split("/").pop() ?? ""))) add(25, "names the company");
    if (/logo/i.test(alt)) score += 5;
    // Customer-logo walls: a section with many logo-ish images that don't name the company.
    const section = $el.closest("section, ul, [class*=logos], [class*=customers], [class*=marquee]");
    if (!named(alt) && section.length && section.find("img, svg").length >= 5 && !inHeader) add(-40, "logo wall");
    if (PHOTO_ALT.test(alt)) add(-50, "looks like a photo");
    if (score <= 0) return;
    const prev = out.get(abs);
    if (!prev || prev.score < score) out.set(abs, { src: abs, alt, score, evidence: why.join(", ") });
  };

  $("img").each((_, el) => consider(el, "img"));
  // Only top-level SVGs (not icons inside buttons): within the header/home link or named logo.
  $("svg").each((_, el) => {
    const $el = $(el);
    if ($el.parents("svg").length) return;
    const anchored = $el.closest("a").length > 0 || /logo|brand/i.test(`${$el.attr("class") ?? ""} ${$el.parent().attr("class") ?? ""}`);
    if (anchored) consider(el, "svg");
  });
  return [...out.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}
