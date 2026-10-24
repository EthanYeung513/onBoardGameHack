import { describe, expect, it } from "vitest";
import { SAMPLE_SPECS, sampleQuiz } from "@/lib/flow/sample";
import { validateFlowSpec } from "@/lib/flow/spec";
import { friendlyLog, fromSteps, levelsOf, scanFindings, toSteps, typographyOf } from "@/lib/orthogonal/mapping";
import { DEFAULT_TOKENS } from "@/lib/schemas/tokens";

const model = { features: [{ name: "Notes", description: "Write", sourceUrls: ["https://x.test/"] }, { name: "Sync", description: "Sync", sourceUrls: ["https://x.test/features"] }] };

describe("FlowSpec to constructor steps", () => {
  it("maps every sample to steps of the constructor kinds", () => {
    for (const spec of SAMPLE_SPECS) {
      const steps = toSteps(spec, DEFAULT_TOKENS, model);
      expect(steps).toHaveLength(spec.steps.length);
      expect(steps[0].kind).toBe("welcome");
      expect(steps.at(-1)?.kind).toBe("done");
      for (const s of steps) expect(s.theme.fg).toMatch(/^#/);
    }
  });

  it("gives quiz steps their full marks and keeps option labels", () => {
    const steps = toSteps(sampleQuiz, DEFAULT_TOKENS, model);
    const i = sampleQuiz.steps.findIndex((s) => s.type === "quiz_question");
    const quiz = sampleQuiz.steps[i];
    expect(steps[i].kind).toBe("choice");
    if (quiz.type === "quiz_question") expect(steps[i].options).toEqual(quiz.options.map((o) => o.label));
    expect(steps[i].xp).toBe(quiz.points ?? 20);
  });

  it("builds levels that start at zero and end at the full total", () => {
    const steps = toSteps(SAMPLE_SPECS[0], DEFAULT_TOKENS, model);
    const levels = levelsOf(SAMPLE_SPECS[0], steps);
    expect(levels[0].at).toBe(0);
    expect(levels.at(-1)?.at).toBe(1);
    expect(levels.map((l) => l.level)).toEqual(levels.map((_, i) => i + 1));
  });
});

describe("constructor edits back to FlowSpec", () => {
  it("round trips without edits and stays valid", () => {
    for (const spec of SAMPLE_SPECS) {
      const back = fromSteps(toSteps(spec, DEFAULT_TOKENS, model), spec);
      const v = validateFlowSpec(back);
      expect(v.ok, v.ok ? "" : v.errors.join("; ")).toBe(true);
      expect(back.steps.map((s) => s.type)).toEqual(spec.steps.map((s) => s.type));
    }
  });

  it("applies title, description and option edits", () => {
    const spec = SAMPLE_SPECS[0];
    const steps = toSteps(spec, DEFAULT_TOKENS, model);
    const i = steps.findIndex((s) => s.kind === "choice");
    steps[i] = { ...steps[i], title: "Pick one", description: "Edited", options: ["Alpha", ...(steps[i].options ?? []).slice(1)] };
    const back = fromSteps(steps, spec);
    expect(validateFlowSpec(back).ok).toBe(true);
    expect(back.steps[i].title).toBe("Pick one");
    expect(back.steps[i].body).toBe("Edited");
    const st = back.steps[i];
    if (st.type === "single_choice" || st.type === "multiple_choice" || st.type === "quiz_question") expect(st.options[0].label).toBe("Alpha");
  });

  it("converts a re-kinded step and drops badges for removed steps", () => {
    const spec = SAMPLE_SPECS[0];
    const steps = toSteps(spec, DEFAULT_TOKENS, model);
    const i = steps.findIndex((s) => s.kind === "choice");
    steps[i] = { ...steps[i], kind: "toggles", toggles: [{ title: "Email me tips", description: "", on: true }, { title: "Weekly summary", description: "", on: false }] };
    const back = fromSteps(steps, spec);
    expect(back.steps[i].type).toBe("checklist");
    const removed = fromSteps(steps.filter((_, j) => j !== 1), spec);
    for (const b of removed.gamification.mechanics.badges) if (b.rule.kind === "step_completed") expect(removed.steps.some((s) => s.id === (b.rule as { stepId: string }).stepId)).toBe(true);
  });
});

describe("scan findings", () => {
  it("summarises pages and falls back when optional model fields are missing", () => {
    const f = scanFindings(
      {
        companyName: "X",
        productSummary: "A note app. More text.",
        targetAudience: ["Students"],
        valuePropositions: ["Fast"],
        features: model.features,
        keyUserActions: ["Write"],
        toneOfVoice: { adjectives: ["calm"], description: "", sampleCopy: [] },
        assets: [],
        gettingStarted: { summary: "", firstSteps: ["Sign up", "Write a note"], successMoment: "First note" },
      },
      [
        { page_type: "home", fetch_method: "http" },
        { page_type: "pricing", fetch_method: "browser" },
      ],
    );
    expect(f.category).toBe("A note app");
    expect(f.pageCount).toBe(2);
    expect(f.summary).toContain("1 needed a browser");
    expect(f.structure.outline).toEqual(["Welcome", "Sign up", "Write a note", "Done"]);
  });

  it("turns pipeline events into readable lines", () => {
    expect(friendlyLog(["Crawl started", "Fetched https://x.test/ via http (300 words)", "Model call analyse via gateway (attempt 1)", "Model call generate_flow via gateway (attempt 1)"])).toEqual([
      "Fetched https://x.test/ via http (300 words)",
      "Summarising the product, audience and tone",
    ]);
    expect(typographyOf(DEFAULT_TOKENS).heading.family).toBe("Georgia");
  });
});
