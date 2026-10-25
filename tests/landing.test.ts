import { readFileSync } from "node:fs";
import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

// `/` serves the mockup landing (public/index.html, copied verbatim from `main`). Guard against
// drifting from it: no invented CTAs, the burger menu stays, Log in goes to the real sign-in.
describe("landing page", () => {
  const html = readFileSync("public/index.html", "utf8");

  it("is the mockup with only the login link rewired", () => {
    expect(html).toContain("ortho-burger");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('href="login.html"');
    expect(html).not.toMatch(/Build my onboarding|Try the demo scan/);
  });

  it("shows the real Orthogonal mark in the nav brand slot and as the favicon (no mockup UniGo icons)", () => {
    expect(html).toMatch(/class="brand w-nav-brand[^"]*"[^>]*><img src="assets\/orthogonal-mark\.svg"/);
    expect(html).toContain(">Orthogonal</span>");
    expect(html).not.toContain("UniGo_favicon");
    expect(readFileSync("public/assets/orthogonal-mark.svg", "utf8")).toContain('viewBox="0 0 39 39"');
  });

  it("references only assets that exist", () => {
    const refs = new Set([...html.matchAll(/(?:src|href)="assets\/([^"?#]+)/g)].map((m) => decodeURIComponent(m[1])));
    for (const ref of refs) expect(() => readFileSync(`public/assets/${ref}`), ref).not.toThrow();
  });

  // D-34: the five media slots show footage captured from our own games (scripts/capture-landing-media.mjs).
  it("shows our gameplay media in the five slots, every file present", () => {
    const media = new Set([...html.matchAll(/assets\/media\/([^"&,]+)/g)].map((m) => m[1]));
    for (const clip of ["hero-dilemma", "why-world-talk", "brain-games", "agents-dilemma", "agents-battle", "agents-word-match"])
      for (const ext of ["mp4", "webm", "jpg"]) expect(media, `${clip}.${ext}`).toContain(`${clip}.${ext}`);
    expect(media).toContain("explore-world.webp");
    for (const file of media) expect(() => readFileSync(`public/assets/media/${file}`), file).not.toThrow();
    expect(html).not.toMatch(/How_02\.png|How_03\.png|Game-07\.mp4|ortho_(dashboard|gate|world)\.webp/);
  });

  it("gives every gameplay <video> a poster, both formats and lightweight preload", () => {
    const videos = [...html.matchAll(/<video\b[^>]*>[\s\S]*?<\/video>/g)].map((m) => m[0]).filter((v) => v.includes("assets/media/"));
    expect(videos.length).toBeGreaterThanOrEqual(8);
    for (const v of videos) {
      expect(v).toMatch(/\sposter="assets\/media\/[\w-]+\.jpg"/);
      expect(v).toMatch(/preload="metadata"/);
      expect(v).toMatch(/\smuted\b/);
      expect(v).toMatch(/type="video\/webm"/);
      expect(v).toMatch(/type="video\/mp4"/);
    }
  });
});

describe("proxy with no keys", () => {
  afterEach(() => vi.unstubAllEnvs());

  const status = async (path: string) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    const event = {} as NextFetchEvent;
    return ((await proxy(new NextRequest(`http://localhost${path}`), event)) as Response).status;
  };

  it("lets public pages render", async () => {
    for (const path of ["/", "/index.html", "/assets/uniplay.css", "/assets/web-hero.mp4"]) expect(await status(path), path).toBe(200);
  });

  it("refuses the legacy studio without Supabase and manager pages without Convex", async () => {
    for (const path of ["/studio", "/admin", "/api/gen/projects"]) expect(await status(path), path).toBe(503);
    for (const path of ["/dashboard", "/space/new", "/login"]) expect(await status(path), path).toBe(503);
  });
});
