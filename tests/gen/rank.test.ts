import { describe, expect, it } from "vitest";
import { classify, normaliseUrl, rankUrls } from "@/lib/crawl/rank";

const root = "https://www.acme.test";

describe("URL ranking", () => {
  it("puts the homepage first and high value sections next", () => {
    const ranked = rankUrls(["/blog/hello", "/pricing", "/docs", "/about", "/random"], root);
    expect(ranked.map((r) => r.pageType).slice(0, 4)).toEqual(["home", "docs", "pricing", "about"]);
    expect(ranked[0].url).toBe("https://www.acme.test/");
    expect(ranked.findIndex((r) => r.pageType === "docs")).toBeLessThan(ranked.findIndex((r) => r.pageType === "blog"));
  });

  it("drops legal pages, tag listings, auth pages, files and other languages", () => {
    for (const path of ["/privacy", "/legal/terms", "/blog/tag/ai", "/login", "/brochure.pdf", "/de/preise", "/fr-fr/produit", "/.well-known/x"]) {
      expect(classify(`${root}${path}`), path).toBeNull();
    }
    expect(classify(`${root}/en/pricing`)).not.toBeNull();
  });

  it("deduplicates www and bare hosts, query strings and fragments", () => {
    const ranked = rankUrls(["https://acme.test/pricing", "https://www.acme.test/pricing?ref=nav", "/pricing#plans", "https://other.test/pricing"], root);
    expect(ranked.map((r) => r.url)).toEqual(["https://www.acme.test/", "https://www.acme.test/pricing"]);
  });

  it("caps the crawl", () => {
    const urls = Array.from({ length: 80 }, (_, i) => `/features/f${i}`);
    expect(rankUrls(urls, root)).toHaveLength(30);
    expect(rankUrls(urls, root, 5)).toHaveLength(5);
  });

  it("prefers shallow paths within a section", () => {
    const [a, b] = rankUrls(["/docs/a/b/c", "/docs/a"], root).slice(1);
    expect(a.url).toBe("https://www.acme.test/docs/a");
    expect(b.score).toBeLessThan(a.score);
  });

  it("rejects non http URLs", () => {
    expect(normaliseUrl("mailto:hi@acme.test")).toBeNull();
    expect(normaliseUrl("javascript:void(0)")).toBeNull();
  });
});

describe("ranking for sites with large sitemaps", () => {
  it("drops per-user pages", () => {
    for (const path of ["/user/abc", "/users/42", "/profile/jo", "/members/x", "/@someone"]) expect(classify(`${root}${path}`), path).toBeNull();
  });

  it("prefers pages the homepage links to", () => {
    const ranked = rankUrls(["/sponsors", "/trends", "/help"], root, 30, ["/help"]);
    expect(ranked[1].url).toBe("https://www.acme.test/help");
  });
});
