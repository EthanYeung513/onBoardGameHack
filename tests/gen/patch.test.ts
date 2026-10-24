import { describe, expect, it } from "vitest";
import { addStep, removeStep, reorderSteps, setThemeToken, setTransition, specDiff, updateStep } from "@/lib/flow/patch";
import { sampleQuest } from "@/lib/flow/sample";

const spec = sampleQuest;
const middle = spec.steps[1];

describe("flow patches", () => {
  it("updates a step's copy and keeps the rest", () => {
    const r = updateStep(spec, middle.id, { title: "A new title" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.spec.steps[1].title).toBe("A new title");
      expect(r.spec.steps.length).toBe(spec.steps.length);
    }
  });

  it("refuses to change a step type", () => {
    const r = updateStep(spec, middle.id, { type: "reward" });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown step ids with a readable error", () => {
    const r = removeStep(spec, "nope");
    expect(r).toEqual({ ok: false, errors: ['No step with id "nope"'] });
  });

  it("will not remove the welcome step because the result is invalid", () => {
    const r = removeStep(spec, spec.steps[0].id);
    expect(r.ok).toBe(false);
  });

  it("adds a valid step before the reward by default", () => {
    const r = addStep(spec, { id: "extra-note", type: "text_input", title: "Anything else?", transition: "fade", inputLabel: "Notes", placeholder: "Optional" });
    if (!r.ok) throw new Error(r.errors.join("; "));
    expect(r.spec.steps.at(-2)?.id).toBe("extra-note");
    expect(r.spec.steps.at(-1)?.type).toBe("reward");
  });

  it("requires every id when reordering", () => {
    expect(reorderSteps(spec, spec.steps.map((s) => s.id).slice(1)).ok).toBe(false);
    const ids = spec.steps.map((s) => s.id);
    const swapped = [ids[0], ids[2], ids[1], ...ids.slice(3)];
    const r = reorderSteps(spec, swapped);
    if (r.ok) expect(r.spec.steps.map((s) => s.id)).toEqual(swapped);
  });

  it("only accepts transitions from the fixed set", () => {
    expect(setTransition(spec, middle.id, "spin").ok).toBe(false);
    const r = setTransition(spec, middle.id, "morph");
    expect(r.ok && r.spec.steps[1].transition).toBe("morph");
  });

  it("validates theme tokens", () => {
    expect(setThemeToken(spec, "primary", "orange").ok).toBe(false);
    expect(setThemeToken(spec, "glow", "#ffffff").ok).toBe(false);
    const r = setThemeToken(spec, "primary", "#123456");
    expect(r.ok && r.spec.themeOverrides?.primary).toBe("#123456");
  });

  it("produces a unified diff", () => {
    const r = updateStep(spec, middle.id, { title: "Changed" });
    if (!r.ok) throw new Error("patch failed");
    const d = specDiff(spec, r.spec, "v1", "v2");
    expect(d).toContain("-");
    expect(d).toContain('+      "title": "Changed"');
  });
});
