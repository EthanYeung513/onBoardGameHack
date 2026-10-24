// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { NextRequest, type NextFetchEvent } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import LandingPage from "@/app/(site)/page";
import { proxy } from "@/proxy";

describe("landing page", () => {
  it("sends the main CTA to sign-in then space creation, and offers login and the demo", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Make onboarding fun!" })).toBeInTheDocument();
    const build = screen.getAllByRole("link", { name: "Build my onboarding" });
    expect(build.length).toBeGreaterThan(0);
    for (const a of build) expect(a).toHaveAttribute("href", "/login?next=/space/new");
    expect(within(screen.getByRole("banner")).getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    for (const a of screen.getAllByRole("link", { name: "Try the demo scan" })) expect(a).toHaveAttribute("href", "/try");
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
    for (const path of ["/", "/classic", "/classic/assets/uniplay.css", "/try", "/landing/game-road.mp4"]) expect(await status(path), path).toBe(200);
  });

  it("refuses the legacy studio without Supabase and manager pages without Convex", async () => {
    for (const path of ["/studio", "/admin", "/api/gen/projects"]) expect(await status(path), path).toBe(503);
    for (const path of ["/dashboard", "/space/new", "/login"]) expect(await status(path), path).toBe(503);
  });
});
