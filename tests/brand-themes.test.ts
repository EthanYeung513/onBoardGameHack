import { describe, expect, it } from "vitest";
import { buildThemes, dominantStyle, luminance } from "@/lib/brand/themes";

const base = { primary: "#0071e3", accent: "#2997ff", surface: "#ffffff", text: "#1d1d1f", headingFont: "SF Pro Display", bodyFont: "SF Pro Text", radius: "12px", logoUrl: "https://x/logo.svg" };

describe("theme options from the extracted identity (D-34)", () => {
  it("a site built on backdrop-blur glass gets a frosted-glass option, all in the company's fonts and logo", () => {
    const themes = buildThemes({ ...base, style: { glass: 15, translucent: 49, gradients: 2, shadows: 4, roundRadius: 18 } });
    expect(themes.map((t) => t.id)).toEqual(["signature", "light", "dark", "bold"]);
    expect(themes[0]).toMatchObject({ name: "Frosted glass", recommended: true, style: "glass" });
    expect(themes.filter((t) => t.style === "glass")).toHaveLength(1);
    // Some glass, but not the site's main style: an extra frosted-glass card.
    const some = buildThemes({ ...base, style: { glass: 1, translucent: 2, gradients: 0, shadows: 0, roundRadius: 18 } });
    expect(some.find((t) => t.id === "glass")).toMatchObject({ style: "glass", radius: "18px" });
    for (const t of themes) expect(t).toMatchObject({ headingFont: "SF Pro Display", bodyFont: "SF Pro Text", logoUrl: "https://x/logo.svg" });
  });

  it("a flat site gets a bold option instead; light and dark keep text readable", () => {
    const themes = buildThemes({ ...base, surface: "#f7f7f7", style: { glass: 0, translucent: 0, gradients: 0, shadows: 0, roundRadius: null } });
    expect(themes.map((t) => t.style)).not.toContain("glass");
    expect(themes.find((t) => t.id === "bold")?.palette.surface).toBe("#0071e3");
    const dark = themes.find((t) => t.id === "dark")!;
    expect(luminance(dark.palette.surface)).toBeLessThan(0.1);
    expect(dark.palette.text).toBe("#ffffff");
  });

  it("drops a variant identical to the signature (a white-surface site's Light theme)", () => {
    const themes = buildThemes({ ...base, text: "#111114", style: null });
    expect(themes.filter((t) => t.palette.surface === "#ffffff" && t.style === "flat")).toHaveLength(1);
    expect(themes.length).toBeGreaterThanOrEqual(3);
  });

  it("reads the strongest style cue", () => {
    expect(dominantStyle(null)).toBe("flat");
    expect(dominantStyle({ glass: 1, translucent: 12, gradients: 0, shadows: 0, roundRadius: null })).toBe("glass");
    expect(dominantStyle({ glass: 0, translucent: 0, gradients: 9, shadows: 0, roundRadius: null })).toBe("gradient");
  });
});

describe("logo tone and chip", () => {
  it("reads an SVG's ink and only chips a logo that would vanish", async () => {
    const { svgLogoTone, logoChip } = await import("@/lib/brand/themes");
    expect(svgLogoTone('<svg><path fill="#fff" d="M0"/><path style="fill:white" d="M1"/></svg>')).toBe("light");
    expect(svgLogoTone('<svg><path d="M0"/></svg>')).toBe("dark"); // undeclared fill is black
    expect(svgLogoTone('<svg><path fill="rgb(29, 29, 31)" d="M0"/></svg>')).toBe("dark");
    expect(svgLogoTone("<svg></svg>")).toBeNull();
    // Linear's inline logo: currentColor painted with the SVG's own colour.
    expect(svgLogoTone('<svg fill="currentColor" color="currentColor" style="color: rgb(247, 248, 248);"><path d="M0"/></svg>')).toBe("light");
    expect(svgLogoTone('<svg fill="currentColor"><path d="M0"/></svg>')).toBe("dark");
    expect(logoChip("#101014", "dark")).toBe("light");
    expect(logoChip("#101014", "light")).toBeNull();
    expect(logoChip("#ffffff", "light")).toBe("dark");
    expect(logoChip("#ffffff", null)).toBeNull();
  });
});
