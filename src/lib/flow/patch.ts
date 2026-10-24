import { createTwoFilesPatch } from "diff";
import { ThemeOverrides, Transition, validateFlowSpec, type FlowSpec, type Step } from "./spec";

// Validated edits to a flow spec. Every operation returns either the new spec or readable errors;
// nothing is saved unless the whole result validates.

export type PatchResult = { ok: true; spec: FlowSpec; summary: string } | { ok: false; errors: string[] };

const clone = (s: FlowSpec): FlowSpec => structuredClone(s);

function finish(spec: unknown, summary: string): PatchResult {
  const r = validateFlowSpec(spec);
  return r.ok ? { ok: true, spec: r.spec, summary } : { ok: false, errors: r.errors };
}

function indexOf(spec: FlowSpec, stepId: string): number {
  return spec.steps.findIndex((s) => s.id === stepId);
}

export function updateStep(spec: FlowSpec, stepId: string, changes: Record<string, unknown>): PatchResult {
  const i = indexOf(spec, stepId);
  if (i < 0) return { ok: false, errors: [`No step with id "${stepId}"`] };
  if ("type" in changes && changes.type !== spec.steps[i].type) return { ok: false, errors: ["Changing a step's type is not allowed; remove it and add a new step instead"] };
  const next = clone(spec);
  next.steps[i] = { ...next.steps[i], ...changes, id: changes.id === undefined ? next.steps[i].id : (changes.id as string) } as Step;
  return finish(next, `Updated step "${stepId}" (${Object.keys(changes).join(", ")})`);
}

export function addStep(spec: FlowSpec, step: unknown, afterStepId?: string): PatchResult {
  const next = clone(spec);
  const at = afterStepId ? indexOf(spec, afterStepId) : next.steps.length - 2;
  if (afterStepId && at < 0) return { ok: false, errors: [`No step with id "${afterStepId}"`] };
  next.steps.splice(at + 1, 0, step as Step);
  return finish(next, `Added step "${(step as Step)?.id}" after "${next.steps[at]?.id}"`);
}

export function removeStep(spec: FlowSpec, stepId: string): PatchResult {
  const i = indexOf(spec, stepId);
  if (i < 0) return { ok: false, errors: [`No step with id "${stepId}"`] };
  const next = clone(spec);
  next.steps.splice(i, 1);
  return finish(next, `Removed step "${stepId}"`);
}

export function reorderSteps(spec: FlowSpec, order: string[]): PatchResult {
  const ids = spec.steps.map((s) => s.id);
  if (order.length !== ids.length || new Set(order).size !== order.length || order.some((id) => !ids.includes(id))) {
    return { ok: false, errors: [`Order must list every existing step id exactly once: ${ids.join(", ")}`] };
  }
  const next = clone(spec);
  next.steps = order.map((id) => spec.steps.find((s) => s.id === id)!);
  return finish(next, `Reordered steps to ${order.join(", ")}`);
}

export function setTransition(spec: FlowSpec, stepId: string, transition: string): PatchResult {
  const t = Transition.safeParse(transition);
  if (!t.success) return { ok: false, errors: [`Transition must be one of ${Transition.options.join(", ")}`] };
  return updateStep(spec, stepId, { transition: t.data });
}

export function setThemeToken(spec: FlowSpec, token: string, value: string): PatchResult {
  const next = clone(spec);
  const overrides = ThemeOverrides.safeParse({ ...(next.themeOverrides ?? {}), [token]: value });
  if (!overrides.success) return { ok: false, errors: overrides.error.issues.map((i) => `${i.path.join(".") || token}: ${i.message}`) };
  next.themeOverrides = overrides.data;
  return finish(next, `Set theme ${token} to ${value}`);
}

export function specDiff(before: FlowSpec, after: FlowSpec, fromLabel: string, toLabel: string): string {
  return createTwoFilesPatch(fromLabel, toLabel, `${JSON.stringify(before, null, 2)}\n`, `${JSON.stringify(after, null, 2)}\n`, "", "", { context: 2 });
}
