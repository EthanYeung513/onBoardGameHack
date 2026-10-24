import { describe, expect, it } from "vitest";
import { z } from "zod";
import { gameCatalogForPrompt, instantiateGame } from "@/games/core/instantiate";
import { seededRandom, seedFrom, shuffle } from "@/games/core/random";
import { gameBaseSchema, type GameSpecDefinition } from "@/games/core/types";

const fake: GameSpecDefinition<unknown> = {
  id: "battle",
  name: "Fake",
  description: "test",
  bestFor: "tests",
  authoringTips: ["be brief"],
  schema: gameBaseSchema.extend({ items: z.array(z.string().describe("an item")).min(1) }) as z.ZodType<unknown>,
  sample: { title: "T", items: ["a"] },
};

describe("instantiateGame", () => {
  it("accepts a valid instance as an object or JSON text", () => {
    const ok = instantiateGame({ game: "battle", spec: { title: "T", items: ["a"] } }, [fake]);
    expect(ok).toMatchObject({ ok: true, game: "battle", spec: { title: "T", items: ["a"] } });
    expect(instantiateGame(JSON.stringify({ game: "battle", spec: { title: "T", items: ["x"] } }), [fake]).ok).toBe(true);
  });

  it("returns readable errors for the model to fix", () => {
    expect(instantiateGame("{nope", [fake])).toEqual({ ok: false, errors: ["Input is not valid JSON"] });
    expect(instantiateGame({ game: "chess", spec: {} }, [fake])).toEqual({ ok: false, errors: ['Unknown game "chess". Available: battle'] });
    const bad = instantiateGame({ game: "battle", spec: { title: "", items: [] } }, [fake]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.startsWith("spec.title"))).toBe(true);
      expect(bad.errors.some((e) => e.startsWith("spec.items"))).toBe(true);
    }
  });

  it("describes each game for the AI with a JSON Schema that keeps field descriptions", () => {
    const [entry] = gameCatalogForPrompt([fake]);
    expect(entry).toMatchObject({ id: "battle", bestFor: "tests", authoringTips: ["be brief"] });
    expect(JSON.stringify(entry.jsonSchema)).toContain("an item");
  });
});

describe("seeded shuffle", () => {
  it("is repeatable for the same seed and keeps every item", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffle(items, seededRandom(seedFrom("deck")));
    const b = shuffle(items, seededRandom(seedFrom("deck")));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(items);
    expect(shuffle(items, seededRandom(1))).not.toEqual(items);
  });
});
