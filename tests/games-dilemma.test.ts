import { describe, expect, it } from "vitest";
import { instantiateGame } from "@/games/core/instantiate";
import { choose, createDilemma, displayedOptions, isThought, maxScore, parseRich, plain, resolveLook, sliceRich, visibleLength } from "@/games/dilemma/logic";
import { dilemmaSample as spec, dilemmaSpecSchema } from "@/games/dilemma/spec";

const pickVerdict = (s: ReturnType<typeof createDilemma>, verdict: "best" | "acceptable" | "wrong") => displayedOptions(s, spec).findIndex((o) => o.verdict === verdict);

describe("dilemma spec", () => {
  it("validates the sample, fills defaults and is instantiable", () => {
    const parsed = dilemmaSpecSchema.parse({ ...spec, player: undefined, credibility: undefined });
    expect(parsed.player).toEqual({ name: "You", character: "phoenix" });
    expect(parsed.credibility).toBe(5);
    expect(instantiateGame({ game: "dilemma", spec }).ok).toBe(true);
  });

  it("rejects unknown speakers, scenes with no best option and duplicate cast ids", () => {
    const scene = spec.scenes[0];
    const unknown = { ...spec, scenes: [{ ...scene, lines: [{ speaker: "ghost", text: "boo" }] }] };
    expect(dilemmaSpecSchema.safeParse(unknown).success).toBe(false);
    const noBest = { ...spec, scenes: [{ ...scene, options: scene.options.map((o) => ({ ...o, verdict: "wrong" as const })) }] };
    expect(dilemmaSpecSchema.safeParse(noBest).success).toBe(false);
    const dupes = { ...spec, cast: [spec.cast[0], spec.cast[0]] };
    expect(dilemmaSpecSchema.safeParse(dupes).success).toBe(false);
  });
});

describe("dilemma logic", () => {
  it("scores best 100, acceptable 50, and wins after the last scene", () => {
    let s = createDilemma(spec, 1);
    s = choose(s, spec, pickVerdict(s, "best")).state;
    s = choose(s, spec, pickVerdict(s, "acceptable")).state;
    expect(s).toMatchObject({ scene: 2, score: 150, correct: 1, credibility: spec.credibility });
    expect(s.mistakes[0]).toMatchObject({ itemId: spec.scenes[1].id, expected: spec.scenes[1].options.find((o) => o.verdict === "best")!.text });
    s = choose(s, spec, pickVerdict(s, "best")).state;
    s = choose(s, spec, pickVerdict(s, "best")).state;
    expect(s.status).toBe("won");
    expect(maxScore(spec)).toBe(400);
    expect(() => choose(s, spec, 0)).toThrow(/over/);
  });

  it("costs credibility for wrong answers and loses when it runs out", () => {
    let s = createDilemma({ ...spec, credibility: 2 }, 1);
    s = choose(s, { ...spec, credibility: 2 }, pickVerdict(s, "wrong")).state;
    expect(s.credibility).toBe(1);
    s = choose(s, spec, pickVerdict(s, "wrong")).state;
    expect(s.status).toBe("lost");
    expect(s.mistakes).toHaveLength(2);
  });

  it("parses emphasis and slices it for the typewriter", () => {
    const segs = parseRich("Hi *there* friend");
    expect(segs).toEqual([
      { text: "Hi ", emphasis: false },
      { text: "there", emphasis: true },
      { text: " friend", emphasis: false },
    ]);
    expect(sliceRich(segs, 5)).toEqual([
      { text: "Hi ", emphasis: false },
      { text: "th", emphasis: true },
    ]);
    expect(visibleLength(segs)).toBe(15);
    expect(plain("a *b* c")).toBe("a b c");
    expect(isThought("(hmm...)")).toBe(true);
    expect(isThought("hmm (ok)")).toBe(false);
  });

  it("generates a stable look and keeps what the spec sets", () => {
    expect(resolveLook("caller")).toEqual(resolveLook("caller"));
    expect(resolveLook("x", { hair: "#123456" }).hair).toBe("#123456");
  });
});
