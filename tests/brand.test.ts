import { describe, expect, it } from "vitest";
import { brandVars, initials, type BrandProfile } from "@/components/manager/brand";

describe("brandVars", () => {
  it("maps palette roles to the mockup's CSS variables and falls back to Orthogonal defaults", () => {
    expect(brandVars(null)).toEqual({ "--brand": "#2f6bff", "--accent": "#ff5c39" });
    const b = {
      palette: [
        { name: "Blurple", hex: "#635bff", role: "primary" },
        { name: "Night", hex: "#0a2540", role: "text" },
      ],
      typography: { heading: { family: "Sohne" }, body: { family: "Inter", fallback: "sans-serif" }, notes: "" },
    } as unknown as BrandProfile;
    expect(brandVars(b)).toMatchObject({ "--brand": "#635bff", "--accent": "#ff5c39", "--ink": "#0a2540", "--font-body": '"Inter", sans-serif' });
    expect(initials("acme pay")).toBe("AC");
  });
});
