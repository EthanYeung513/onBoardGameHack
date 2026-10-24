import { describe, expect, it } from "vitest";
import { buildRequest, shipRequest } from "@/lib/orthogonal/schema";
import { normaliseSiteUrl, siteNameOf } from "@/lib/orthogonal/site";
import { isLight, levelFor, retheme, rethemeBackground, tints, xpAt } from "@/lib/orthogonal/theme";
import { buildProject, publishProject, pushProject, scanSite } from "@/services/orthogonal";

const brand = { ink: "#0F3D2E", paper: "#FBF7EE", accent: "#F5B400" };

describe("site", () => {
  it("normalises URLs and falls back to the demo site", () => {
    expect(normaliseSiteUrl(" https://Acme.io/ ")).toBe("acme.io");
    expect(normaliseSiteUrl("")).toBe("lumen.energy");
    expect(siteNameOf("acme.io/app")).toBe("Acme");
  });
});

describe("theme", () => {
  it("classifies the Lumen palette like the design does", () => {
    expect(["#FBF7EE", "#F5B400", "#fff"].map(isLight)).toEqual([true, true, true]);
    expect(["#0F3D2E", "#1E2A2B", "#FF5A3C"].map(isLight)).toEqual([false, false, false]);
    expect(tints("#FBF7EE")).toEqual({ line: "rgba(251,247,238,0.25)", track: "rgba(251,247,238,0.18)" });
  });

  it("picks readable text when recolouring and moves a clashing accent", async () => {
    const [welcome] = (await buildProject({ scanId: "s", siteUrl: "lumen.energy", repo: null, description: "" })).steps;
    expect(retheme(welcome, brand, "#0F3D2E", "#F5B400").theme).toEqual({ bg: "#0F3D2E", fg: "#FBF7EE", accent: "#F5B400", onAccent: "#0F3D2E" });
    // Welcome's accent is Sun; a Sun background would hide it, so the accent becomes ink.
    expect(rethemeBackground(welcome, brand, "#F5B400").theme.accent).toBe("#0F3D2E");
  });

  it("counts XP and levels", async () => {
    const { steps, levels } = await buildProject({ scanId: "s", siteUrl: "lumen.energy", repo: null, description: "" });
    expect(xpAt(steps, 0)).toBe(0);
    expect(xpAt(steps, 5)).toBe(120);
    expect(levelFor(levels, 0, 120).name).toBe("Rookie");
    expect(levelFor(levels, 60, 120).name).toBe("Rising");
    expect(levelFor(levels, 120, 120)).toMatchObject({ level: 2, name: "Sun catcher" });
  });
});

describe("mock backend", () => {
  it("scans and builds for the visitor's site", async () => {
    const scan = await scanSite("https://acme.io");
    expect(scan).toMatchObject({ siteUrl: "acme.io", siteName: "Acme" });
    expect(scan.log[0]).toBe("Resolving acme.io");
    const project = await buildProject({ scanId: scan.id, siteUrl: scan.siteUrl, repo: "acme/web", description: "" });
    expect(project.steps[0].title).toBe("Welcome to Acme");
    expect(project.connectors.find((c) => c.id === "github")?.enabled).toBe(true);
    expect(project.log.filter((e) => e.step).map((e) => e.step)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("publishes to Vercel or the Orthogonal CDN", async () => {
    const { id, steps } = await buildProject({ scanId: "s", siteUrl: "acme.io", repo: null, description: "" });
    const connectors = { github: false, vercel: true, supabase: true, cloudflare: false };
    const req = shipRequest.parse({ siteUrl: "acme.io", repo: null, steps, connectors });
    expect(await publishProject(id, req)).toEqual({ host: "onboarding.acme.io", via: "vercel", storage: "supabase" });
    expect(await publishProject(id, { ...req, connectors: { ...connectors, vercel: false } })).toMatchObject({ via: "orthogonal", storage: null });
    expect(await pushProject(id, req)).toMatchObject({ repo: "acme/web", branch: "orthogonal/onboarding" });
  });

  it("rejects malformed repositories", () => {
    expect(() => buildRequest.parse({ scanId: "s", siteUrl: "acme.io", repo: "not a repo", description: "" })).toThrow();
  });
});
