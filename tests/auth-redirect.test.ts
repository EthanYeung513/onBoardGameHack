import { describe, expect, it } from "vitest";
import { allowlistFromEnv, resolveAuthRedirect } from "@convex/lib/authRedirect";

describe("OAuth return URL", () => {
  const site = "https://orthogonal-app.vercel.app";

  it("resolves relative paths against SITE_URL and keeps allowed absolute origins", () => {
    expect(resolveAuthRedirect("/dashboard", site)).toBe(`${site}/dashboard`);
    expect(resolveAuthRedirect("?code=1", `${site}/`)).toBe(`${site}?code=1`);
    expect(resolveAuthRedirect(`${site}/space/new`, site)).toBe(`${site}/space/new`);
    expect(resolveAuthRedirect("https://preview.example.dev/dashboard", site, allowlistFromEnv(" https://preview.example.dev , "))).toBe("https://preview.example.dev/dashboard");
  });

  it("never redirects to an unlisted origin (open-redirect guard)", () => {
    expect(resolveAuthRedirect("https://evil.example/steal", site)).toBe(site);
    expect(resolveAuthRedirect("//evil.example", site)).toBe(site);
    expect(resolveAuthRedirect("javascript:alert(1)", site)).toBe(site);
  });

  it("lets a local dev backend return to any loopback port, but not a remote site to loopback", () => {
    expect(resolveAuthRedirect("http://127.0.0.1:3130/dashboard", "http://localhost:3000")).toBe("http://127.0.0.1:3130/dashboard");
    expect(resolveAuthRedirect("http://localhost:3130/dashboard", site)).toBe(site);
  });
});
