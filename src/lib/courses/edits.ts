import type { CoursePatch } from "../flow/course-patch";
import type { CourseSpec } from "../flow/course-spec";

// What one assistant edit changed, in the compact form Mubit learns from (course_edits rows):
// the step outline before/after and a few structural signals ("added 1 scenario step", "lessons
// shortened to at most 2 lines"). Pure and dependency-free: imported by Convex (relative imports only).

export type StepOutline = { kind: string; title: string; lines: number };

const lineCount = (body?: string) => (body ? body.split(/\n+/).filter((l) => l.trim()).length : 0);

export function outline(spec: CourseSpec): StepOutline[] {
  return (spec.steps ?? []).map((s) => ({ kind: s.kind, title: s.title, lines: lineCount(s.body) }));
}

const count = (o: StepOutline[], kind: string) => o.filter((s) => s.kind === kind).length;
const avgLessonLines = (o: StepOutline[]) => {
  const ls = o.filter((s) => s.kind === "lesson");
  return ls.length ? ls.reduce((n, s) => n + s.lines, 0) / ls.length : 0;
};
const changed = (before: CourseSpec, after: CourseSpec) =>
  after.steps.filter((s) => {
    const old = before.steps.find((o) => o.id === s.id);
    return old && JSON.stringify(old) !== JSON.stringify(s);
  });

/** Structural signals of an edit; the offline distiller and the Mubit prompt both read these. */
export function editSignals(before: CourseSpec, after: CourseSpec): string[] {
  const b = outline(before);
  const a = outline(after);
  const out: string[] = [];
  if (before.title !== after.title) out.push("renamed the course");
  for (const kind of ["lesson", "quiz", "scenario", "checklist"]) {
    const d = count(a, kind) - count(b, kind);
    if (d > 0) out.push(`added ${d} ${kind} step${d > 1 ? "s" : ""}`);
    if (d < 0) out.push(`removed ${-d} ${kind} step${d < -1 ? "s" : ""}`);
  }
  const lb = avgLessonLines(b);
  const la = avgLessonLines(a);
  const maxAfter = Math.max(0, ...a.filter((s) => s.kind === "lesson").map((s) => s.lines));
  if (la && lb && la < lb - 0.4) out.push(`lessons shortened to at most ${maxAfter} lines`);
  if (la && lb && la > lb + 0.4) out.push("lessons lengthened");
  const options = (spec: CourseSpec) => spec.steps.filter((s) => s.kind === "quiz").reduce((n, s) => n + (s.options?.length ?? 0), 0);
  if (count(a, "quiz") === count(b, "quiz") && options(after) !== options(before)) out.push(options(after) > options(before) ? "quizzes got more options" : "quizzes got fewer options");
  const rewritten = changed(before, after);
  if (rewritten.length) out.push(`rewrote ${[...new Set(rewritten.map((s) => s.kind))].join("/")} step${rewritten.length > 1 ? "s" : ""}`);
  return out;
}

/** One line for the manager and the audit log: what the patches did, by step title. */
export function patchSummary(patches: CoursePatch[], before: CourseSpec, after: CourseSpec): string {
  const parts: string[] = [];
  const beforeIds = new Set(before.steps.map((s) => s.id));
  const afterIds = new Set(after.steps.map((s) => s.id));
  for (const s of after.steps) if (!beforeIds.has(s.id)) parts.push(`added ${s.kind} "${s.title}"`);
  for (const s of before.steps) if (!afterIds.has(s.id)) parts.push(`removed ${s.kind} "${s.title}"`);
  for (const s of changed(before, after)) parts.push(`rewrote ${s.kind} "${s.title}"`);
  if (before.title !== after.title) parts.push(`renamed to "${after.title}"`);
  return (parts.length ? parts.join("; ") : patches.map((p) => `${p.op} ${p.path}`).join(", ")).slice(0, 600);
}
