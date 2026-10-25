import { validateCourseSpec, type CourseSpec } from "./course-spec";

// Assistant/manager edits to a CourseSpec (BUILD-CONTRACT "Course contract"): a list of
// `{op: 'set'|'add'|'remove', path, value}` operations on JSON-pointer paths ("/title",
// "/steps/2/body", "/steps/-"). Like the FlowSpec patch helpers (./patch.ts) nothing is kept unless
// the whole result validates under the same rules as generation.

export type CoursePatch = { op: "set" | "add" | "remove"; path: string; value?: unknown };
export type CoursePatchResult = { ok: true; spec: CourseSpec; summary: string } | { ok: false; errors: string[] };

export const MAX_PATCHES = 50;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

function parsePath(path: string): string[] | string {
  if (!path.startsWith("/") || path === "/") return `path "${path}" must be a JSON pointer like "/steps/0/title"`;
  const parts = path
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (parts.some((p) => p === "" || FORBIDDEN.has(p))) return `path "${path}" has an invalid segment`;
  return parts;
}

type Container = Record<string, unknown> | unknown[];
const isContainer = (v: unknown): v is Container => typeof v === "object" && v !== null;

function arrayIndex(arr: unknown[], key: string, allowEnd: boolean): number | null {
  if (allowEnd && key === "-") return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) return null;
  const i = Number(key);
  return i < arr.length || (allowEnd && i === arr.length) ? i : null;
}

function applyOne(doc: Record<string, unknown>, patch: CoursePatch, n: number): string | null {
  const at = `patch ${n} (${patch.op} ${patch.path})`;
  const parts = parsePath(patch.path);
  if (typeof parts === "string") return `${at}: ${parts}`;
  if (patch.op !== "remove" && patch.value === undefined) return `${at}: value is required`;
  let parent: unknown = doc;
  for (const key of parts.slice(0, -1)) {
    if (!isContainer(parent)) return `${at}: "${key}" is not inside an object or list`;
    parent = Array.isArray(parent) ? parent[arrayIndex(parent, key, false) ?? -1] : parent[key];
  }
  if (!isContainer(parent)) return `${at}: the parent of this path does not exist`;
  const last = parts[parts.length - 1];
  const value = structuredClone(patch.value);

  if (Array.isArray(parent)) {
    const i = arrayIndex(parent, last, patch.op === "add");
    if (i === null) return `${at}: index "${last}" is out of range`;
    if (patch.op === "add") parent.splice(i, 0, value);
    else if (patch.op === "set") parent[i] = value;
    else parent.splice(i, 1);
    return null;
  }
  const exists = Object.prototype.hasOwnProperty.call(parent, last);
  if (patch.op === "add" && exists) return `${at}: "${last}" already exists — use set`;
  if (patch.op !== "add" && !exists) return `${at}: "${last}" does not exist`;
  if (patch.op === "remove") delete parent[last];
  else parent[last] = value;
  return null;
}

/** Apply all patches to a copy of `spec`; returns the validated result or every error found. */
export function applyCoursePatches(spec: CourseSpec, patches: CoursePatch[], approvedFactIds: ReadonlySet<string>): CoursePatchResult {
  if (patches.length === 0) return { ok: false, errors: ["no patches given"] };
  if (patches.length > MAX_PATCHES) return { ok: false, errors: [`at most ${MAX_PATCHES} patches per edit`] };
  const doc = structuredClone(spec) as unknown as Record<string, unknown>;
  for (const [n, patch] of patches.entries()) {
    if (!["set", "add", "remove"].includes(patch.op)) return { ok: false, errors: [`patch ${n}: op must be set, add or remove`] };
    const error = applyOne(doc, patch, n);
    if (error) return { ok: false, errors: [error] };
  }
  const result = validateCourseSpec(doc, approvedFactIds);
  if (!result.ok) return result;
  return { ok: true, spec: result.spec, summary: patches.map((p) => `${p.op} ${p.path}`).join(", ") };
}

/** Patches that replace steps (matched by id) and then drop `remove` ids — sets first, removes last-to-first. */
export function stepRefreshPatches(spec: CourseSpec, steps: CourseSpec["steps"], remove: string[] = []): CoursePatch[] {
  const index = (id: string) => spec.steps.findIndex((s) => s.id === id);
  const sets: CoursePatch[] = steps.filter((s) => index(s.id) >= 0).map((s) => ({ op: "set", path: `/steps/${index(s.id)}`, value: s }));
  const removes: CoursePatch[] = remove
    .map(index)
    .filter((i) => i >= 0)
    .sort((a, b) => b - a)
    .map((i) => ({ op: "remove", path: `/steps/${i}` }));
  return [...sets, ...removes];
}
