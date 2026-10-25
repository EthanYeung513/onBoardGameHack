import { describe, expect, it } from "vitest";
import { findLogoCandidates } from "@/lib/design/logo";

// F5: the company's own logo, not customer logos or photos.

const page = (body: string) => `<!doctype html><html><head><title>Acme</title></head><body>${body}</body></html>`;
const svg = (label: string) => `<svg viewBox="0 0 100 20" aria-label="${label}"><path d="M0 0h100v20H0z" fill="#635bff"/></svg>`;

describe("findLogoCandidates", () => {
  it("ranks the inline SVG in the header's home link first and stores it as a data: URI", () => {
    const html = page(`<header><nav><a href="/" aria-label="Acme home">${svg("Acme logo")}</a><a href="/pricing">Pricing</a></nav></header>
      <section class="customers">${["Figma", "OpenAI", "Cursor", "Vercel", "Ramp"].map((n) => `<img src="/l/${n}.svg" alt="${n}" class="logo">`).join("")}</section>`);
    const [top] = findLogoCandidates(html, "https://www.acme.com/");
    expect(top.src).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(Buffer.from(top.src.split(",")[1], "base64").toString()).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(top.evidence).toContain("home link in the header");
  });

  it("never picks customer-logo walls or photos as the company logo", () => {
    const html = page(`<section>${["Figma", "OpenAI", "Cursor", "Vercel", "Ramp", "Notion"].map((n) => `<img src="/l/${n}.svg" alt="${n} logo">`).join("")}</section>
      <img src="/brand/hero.jpg" alt="Aerial view of a street intersection">`);
    const found = findLogoCandidates(html, "https://acme.com/");
    expect(found.every((c) => !/Figma|OpenAI|Cursor|Vercel|Ramp|Notion|hero/.test(c.src))).toBe(true);
  });

  it("finds an <img> logo in the header that names the company, with a relative src resolved", () => {
    const html = page(`<div class="site-header"><a href="/"><img src="/assets/acme_logo.svg" alt="Acme logo"></a></div><img src="/assets/acme_logo_dark.svg">`);
    const found = findLogoCandidates(html, "https://acme.com/en/");
    expect(found[0]).toMatchObject({ src: "https://acme.com/assets/acme_logo.svg", alt: "Acme logo" });
    expect(found[0].score).toBeGreaterThan(found[1]?.score ?? 0);
  });
});
