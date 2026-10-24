import * as cheerio from "cheerio";
import TurndownService from "turndown";

// HTML helpers used by the crawler and the design token fallback.

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "form"]);
turndown.remove((node) => node.nodeName.toLowerCase() === "svg");

export interface ParsedPage {
  title: string;
  markdown: string;
  links: string[];
  stylesheets: string[];
  inlineCss: string;
  images: Array<{ src: string; alt: string }>;
  icons: string[];
  meta: Record<string, string>;
}

export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const abs = (href: string | undefined) => {
    if (!href) return null;
    try {
      return new URL(href, baseUrl).toString();
    } catch {
      return null;
    }
  };
  const links = $("a[href]")
    .map((_, el) => abs($(el).attr("href")))
    .get()
    .filter((x): x is string => Boolean(x));
  const stylesheets = $('link[rel="stylesheet"][href]')
    .map((_, el) => abs($(el).attr("href")))
    .get()
    .filter((x): x is string => Boolean(x));
  const inlineCss = $("style").map((_, el) => $(el).html() ?? "").get().join("\n");
  const images = $("img[src]")
    .map((_, el) => ({ src: abs($(el).attr("src")) ?? "", alt: $(el).attr("alt") ?? "" }))
    .get()
    .filter((i) => i.src);
  const icons = $('link[rel~="icon"][href], link[rel="apple-touch-icon"][href]')
    .map((_, el) => abs($(el).attr("href")))
    .get()
    .filter((x): x is string => Boolean(x));
  const meta: Record<string, string> = {};
  $("meta[name], meta[property]").each((_, el) => {
    const k = $(el).attr("name") ?? $(el).attr("property");
    const v = $(el).attr("content");
    if (k && v) meta[k.toLowerCase()] = v;
  });
  const title = ($("title").first().text() || meta["og:title"] || "").trim();

  const body = $("main").length ? $("main").first() : $("body");
  body.find("nav, footer, header [role=navigation]").remove();
  const markdown = turndown
    .turndown(body.html() ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, markdown, links, stylesheets, inlineCss, images, icons, meta };
}

/** Visible words in a Markdown string, used to spot client rendered pages. */
export function wordCount(markdown: string): number {
  return markdown.replace(/[#*_`>\[\]()!-]/g, " ").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}
