import type { Step, StepKind } from "@/lib/orthogonal/types";

export const KIND_LABEL: Record<StepKind, string> = {
  welcome: "Welcome screen",
  choice: "Single choice",
  fields: "Form",
  toggles: "Preferences",
  done: "Completion",
};

export const KINDS = Object.keys(KIND_LABEL) as StepKind[];

const DEFAULT_OPTIONS = ["Option A", "Option B", "Option C"];

/**
 * Changes a step's kind. Content the new kind needs but the step lacks is borrowed from the first step of that
 * kind in the flow, so switching a step to "Preferences" shows the flow's real toggles rather than an empty card.
 */
export function withKind(step: Step, kind: StepKind, steps: Step[]): Step {
  const template = steps.find((s) => s.kind === kind);
  return {
    ...step,
    kind,
    options: step.options ?? template?.options ?? (kind === "choice" ? DEFAULT_OPTIONS : undefined),
    fields: step.fields ?? template?.fields,
    toggles: step.toggles ?? template?.toggles,
    chips: step.chips ?? template?.chips,
  };
}
