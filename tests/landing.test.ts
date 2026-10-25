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

  it("references only assets that exist", () => {
    const refs = new Set([...html.matchAll(/(?:src|href)="assets\/([^"?#]+)/g)].map((m) => decodeURIComponent(m[1])));
    for (const ref of refs) expect(() => readFileSync(`public/assets/${ref}`), ref).not.toThrow();
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
