import * as motionReact from "motion/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SCORING_RUNTIME, exportFiles, exportStandaloneComponent, exportThemeCss } from "@/lib/flow/export";
import { SAMPLE_SPECS, sampleQuest, sampleQuiz, sampleStreak } from "@/lib/flow/sample";
import { currentStep, flowReducer, initFlowState, type FlowAction, type FlowState } from "@/lib/flow/scoring";
import type { FlowSpec } from "@/lib/flow/spec";
import { DEFAULT_TOKENS } from "@/lib/schemas/tokens";

const MODULES: Record<string, unknown> = { react: React, "react/jsx-runtime": jsxRuntime, "motion/react": motionReact };

/** Compile the exported JSX the way a bundler would and load it with only react and motion available. */
function loadExport(source: string): Record<string, unknown> {
  const out = ts.transpileModule(source, {
    fileName: "OnboardingFlow.jsx",
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (!(id in MODULES)) throw new Error(`exported component imported "${id}"`);
    return MODULES[id];
  };
  new Function("require", "module", "exports", out.outputText)(req, mod, mod.exports);
  return mod.exports;
}

type Runtime = { initFlowState: typeof initFlowState; flowReducer: typeof flowReducer };
const runtime = new Function(`${SCORING_RUNTIME}\nreturn { initFlowState, flowReducer };`)() as Runtime;

function script(spec: FlowSpec): FlowAction[] {
  const answers: Record<string, FlowAction[]> = {
    "trip-type": [{ type: "answer", value: "abroad" }],
    crew: [{ type: "answer", value: ["friends", "partner"] }],
    destination: [{ type: "skip" }],
    invite: [{ type: "answer", value: "sam@example.com" }],
    setup: [{ type: "answer", value: ["photo"] }],
    "budget-style": [{ type: "answer", value: "even" }],
    "first-board": [{ type: "answer", value: ["dates", "idea"] }],
    "trip-name": [{ type: "answer", value: "Porto" }],
    notify: [{ type: "answer", value: ["votes"] }],
    digest: [{ type: "skip" }],
    "q-votes": [{ type: "answer", value: ["owner"] }],
    "q-split": [{ type: "answer", value: ["owe-30"] }],
    role: [{ type: "answer", value: "planner" }, { type: "back" }, { type: "next" }],
    "q-offline": [{ type: "answer", value: ["itinerary", "tickets"] }],
    "q-invite": [{ type: "answer", value: ["link"] }],
  };
  const actions: FlowAction[] = [];
  let s = initFlowState(spec);
  for (let guard = 0; guard < 40 && !s.finished; guard++) {
    const extra = answers[currentStep(s).id] ?? [];
    const step: FlowAction[] = extra.some((a) => a.type === "skip") ? extra : [...extra, { type: "next" }];
    for (const a of step) {
      actions.push(a);
      s = flowReducer(s, a);
    }
  }
  return actions;
}

const pick = (s: FlowState) => ({
  currentIndex: s.currentIndex,
  points: s.points,
  streak: s.streak,
  bestStreak: s.bestStreak,
  quizStreak: s.quizStreak,
  quizCorrect: s.quizCorrect,
  earnedBadgeIds: s.earnedBadgeIds,
  newBadgeIds: s.newBadgeIds,
  outcomes: s.outcomes,
  finished: s.finished,
});

describe("standalone export", () => {
  it.each(SAMPLE_SPECS.map((s) => [s.variantKey, s] as const))("%s: has no app imports and embeds the spec", (_k, spec) => {
    const src = exportStandaloneComponent(spec, DEFAULT_TOKENS);
    expect(src).not.toMatch(/from\s+["']@\//);
    expect(src).not.toContain("@/");
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["motion/react", "react"]);
    expect(src).toContain(`export const SPEC = ${JSON.stringify(spec, null, 2)};`);
    expect(src).toContain("export default function OnboardingFlow");
  });

  it("embeds the theme variables, including spec overrides", () => {
    const css = exportThemeCss(sampleQuiz, DEFAULT_TOKENS);
    expect(css).toContain(`--ob-primary: ${DEFAULT_TOKENS.colors.primary};`);
    expect(css).toContain("--ob-accent: #5f3dc4;");
    expect(css).toContain("--ob-on-primary: #ffffff;");
    expect(exportStandaloneComponent(sampleQuiz, DEFAULT_TOKENS)).toContain(JSON.stringify(css));
  });

  it("returns the three files", () => {
    const files = exportFiles(sampleQuest, DEFAULT_TOKENS);
    expect(files.map((f) => f.path)).toEqual(["flow.json", "theme.css", "OnboardingFlow.jsx"]);
    expect(JSON.parse(files[0].content)).toEqual(sampleQuest);
    expect(files[1].content).toContain(".ob-root {");
  });

  it.each(SAMPLE_SPECS.map((s) => [s.variantKey, s] as const))("%s: compiles and renders with only react and motion", (_k, spec) => {
    const mod = loadExport(exportStandaloneComponent(spec, DEFAULT_TOKENS));
    expect(mod.SPEC).toEqual(spec);
    const Flow = mod.default as React.ComponentType<{ initialIndex?: number }>;
    const html = renderToString(React.createElement(Flow));
    expect(html).toContain(`data-testid="flow-step-${spec.steps[0].id}"`);
    expect(html).toContain('data-testid="flow-next"');
    expect(html).toContain('data-testid="flow-points"');
    const mid = renderToString(React.createElement(Flow, { initialIndex: 2 }));
    expect(mid).toContain(`data-testid="flow-step-${spec.steps[2].id}"`);
  });

  it.each([sampleQuest, sampleStreak, sampleQuiz].map((s) => [s.variantKey, s] as const))(
    "%s: the embedded scoring runtime matches scoring.ts action by action",
    (_k, spec) => {
      const actions = script(spec);
      let a = initFlowState(spec);
      let b = runtime.initFlowState(spec);
      expect(pick(b)).toEqual(pick(a));
      for (const action of actions) {
        a = flowReducer(a, action);
        b = runtime.flowReducer(b, action);
        expect(pick(b)).toEqual(pick(a));
      }
      expect(a.finished).toBe(true);
      b = runtime.flowReducer(b, { type: "restart" });
      expect(pick(b)).toEqual(pick(initFlowState(spec)));
    },
  );
});
