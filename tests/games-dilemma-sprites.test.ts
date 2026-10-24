import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allAssetTitles, assetFile, backgroundFor, CHARACTER_IDS, spriteFor, viewForSetting } from "@/games/dilemma/sprites";
import { MOODS } from "@/games/dilemma/spec";

describe("Ace Attorney sprites", () => {
  it("has every listed file downloaded into public/ (run npm run fetch:ace-attorney if not)", () => {
    const missing = allAssetTitles().filter((t) => !existsSync(path.join(process.cwd(), "public/games/ace-attorney", assetFile(t))));
    expect(missing).toEqual([]);
  });

  it("resolves a sprite for every character in every mood, talking or not", () => {
    for (const id of CHARACTER_IDS) {
      for (const mood of MOODS) {
        expect(spriteFor(id, mood, false)).toMatch(/^\/games\/ace-attorney\/.+\.gif$/);
        expect(spriteFor(id, mood, true)).toMatch(/\.gif$/);
      }
    }
    expect(spriteFor("phoenix", "neutral", true)).toBe("/games/ace-attorney/phoenix-wright-normal-talking.gif");
    expect(spriteFor("phoenix", "neutral", false, "point")).toBe("/games/ace-attorney/phoenix-wright-point.gif");
  });

  it("maps settings to Ace Attorney locations", () => {
    expect(viewForSetting("office")).toBe("office");
    expect(viewForSetting("video-call")).toBe("witness");
    expect(backgroundFor("defense")).toBe("/games/ace-attorney/defense-thd.png");
    expect(assetFile("Fey_&_Co._Office_entrance.png")).toBe("fey-co.-office-entrance.png");
  });
});
