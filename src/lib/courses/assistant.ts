import { z } from "zod";
import { applyCoursePatches, MAX_PATCHES, type CoursePatch } from "../flow/course-patch";
import type { CourseSpec } from "../flow/course-spec";

// The course page's AI assistant (`course.assist` through Mubit). The manager's instruction, the
// course JSON, the approved facts and the learned preferences go in the user message; the model
// answers with CoursePatch[] that must apply and validate (approved facts only) or the errors go
// back to it. Relative imports only: the Convex action bundles this file.

export const COURSE_ASSIST_TASK = "course.assist";
export const MAX_ASSIST_FACTS = 150;

export const AssistOutput = z.object({
  reply: z.string().trim().min(1).max(600),
  patches: z
    .array(z.object({ op: z.enum(["set", "add", "remove"]), path: z.string().min(2).max(160), value: z.unknown().optional() }))
    .max(MAX_PATCHES),
});
export type AssistOutput = z.infer<typeof AssistOutput>;

export type AssistFact = { id: string; category: string; text: string };

/** Errors fed back to the model: the patches must apply and the course must still validate. */
export function assistErrors(spec: CourseSpec, approved: ReadonlySet<string>, out: AssistOutput): string[] {
  if (out.patches.length === 0) return [];
  const r = applyCoursePatches(spec, out.patches as CoursePatch[], approved);
  return r.ok ? [] : r.errors;
}

/** Facts the course already teaches first, then the rest, capped so the prompt stays small. */
export function factsForAssist(spec: CourseSpec, facts: AssistFact[]): AssistFact[] {
  const taught = new Set(spec.steps.flatMap((s) => s.teaches_fact_ids));
  return [...facts].sort((a, b) => Number(taught.has(b.id)) - Number(taught.has(a.id))).slice(0, MAX_ASSIST_FACTS);
}

export function assistUserMessage(a: { course: CourseSpec; facts: AssistFact[]; preferences: string[]; instruction: string }): string {
  return JSON.stringify({
    instruction: a.instruction,
    manager_preferences: a.preferences,
    course: a.course,
    facts: factsForAssist(a.course, a.facts),
  });
}

/**
 * Offline stand-in (no MUBIT_API_KEY): only the deterministic edits the mockup's panel did
 * (rename, remove a lesson). Anything else is answered honestly, never simulated.
 */
export function offlineAssist(spec: CourseSpec, instruction: string): AssistOutput {
  const q = instruction.trim();
  if (/^(rename|retitle|call it)\b/i.test(q)) {
    const title = q
      .replace(/^(rename|retitle|call it)\s*(the course|it|this course)?\s*(to|as)?\s*/i, "")
      .trim()
      .slice(0, 80);
    if (!title) return { reply: "What should I rename it to?", patches: [] };
    return { reply: `Renamed the course to "${title}".`, patches: [{ op: "set", path: "/title", value: title }] };
  }
  if (/^(remove|delete|drop|take out)\b/i.test(q)) {
    const kw = q
      .replace(/^(remove|delete|drop|take out)\s*(the\s*)?(lesson\s*)?(on\s*)?/i, "")
      .toLowerCase()
      .replace(/^["']|["']$/g, "");
    const idx = spec.steps.findIndex((s) => s.kind !== "welcome" && s.kind !== "done" && kw && s.title.toLowerCase().includes(kw));
    if (idx < 0) return { reply: "I could not find a lesson matching that. Try quoting its name.", patches: [] };
    return { reply: `Removed "${spec.steps[idx].title}".`, patches: [{ op: "remove", path: `/steps/${idx}` }] };
  }
  return {
    reply: "Mubit is not configured on this deployment, so I can only rename the course or remove a lesson. Set MUBIT_API_KEY to draft new lessons from your company brain.",
    patches: [],
  };
}
