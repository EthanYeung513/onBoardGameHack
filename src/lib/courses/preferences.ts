import { z } from "zod";
import type { StepOutline } from "./edits";

// Distils a space's recent assistant edits into at most five "manager preferences" (the
// `course.preferences` Mubit task), which generate_courses then puts in its user message.
// Offline (no MUBIT_API_KEY) a deterministic distiller reads the edit signals instead, and the
// result is labelled as such. Relative imports only: the Convex action bundles this file.

export const COURSE_PREFERENCES_TASK = "course.preferences";
export const MAX_PREFERENCES = 5;

export const PreferencesOutput = z.object({
  preferences: z
    .array(z.object({ text: z.string().trim().min(3).max(160), evidence_edit_ids: z.array(z.string()).max(30) }))
    .max(MAX_PREFERENCES),
});
export type Preference = { text: string; evidence_edit_ids: string[] };

export type EditEvidence = {
  id: string;
  packType: string;
  instruction: string;
  summary: string;
  signals: string[];
  before: StepOutline[];
  after: StepOutline[];
};

/** Every preference must cite edits that exist. */
export function preferenceErrors(out: { preferences: Preference[] }, editIds: ReadonlySet<string>): string[] {
  return out.preferences.flatMap((p, i) => {
    if (p.evidence_edit_ids.length === 0) return [`preferences.${i}: cite at least one edit id in evidence_edit_ids`];
    const bad = p.evidence_edit_ids.filter((id) => !editIds.has(id));
    return bad.length ? [`preferences.${i}: unknown edit ids ${bad.join(", ")}`] : [];
  });
}

const shortOutline = (o: StepOutline[]) => o.map((s) => `${s.kind}: ${s.title}${s.kind === "lesson" ? ` (${s.lines} lines)` : ""}`);

export function preferencesUserMessage(a: { company: string; edits: EditEvidence[]; current: string[]; recalled: string }): string {
  return JSON.stringify({
    company: a.company,
    current_preferences: a.current,
    similar_companies: a.recalled || "(nothing recalled)",
    edits: a.edits.map((e) => ({ id: e.id, course: e.packType, instruction: e.instruction, changed: e.summary, signals: e.signals, before: shortOutline(e.before), after: shortOutline(e.after) })),
  });
}

type Rule = { text: (edits: EditEvidence[]) => string; match: (e: EditEvidence) => boolean };

const has = (e: EditEvidence, re: RegExp) => e.signals.some((s) => re.test(s)) ;
const RULES: Rule[] = [
  { match: (e) => has(e, /^added \d+ scenario/) || (has(e, /^removed \d+ quiz/) && /scenario/i.test(e.instruction)), text: () => "Prefer scenario steps over quizzes" },
  { match: (e) => has(e, /^removed \d+ quiz/) && !/scenario/i.test(e.instruction), text: () => "Use fewer quizzes" },
  {
    match: (e) => has(e, /^lessons shortened/) || /\b(short(er)?|concise|brief|fewer (lines|bullets))\b/i.test(e.instruction),
    text: (edits) => {
      const n = Math.min(...edits.map((e) => Math.max(0, ...e.after.filter((s) => s.kind === "lesson").map((s) => s.lines))).filter((x) => x > 0));
      return Number.isFinite(n) ? `Keep lessons to ${n} short line${n === 1 ? "" : "s"} or fewer` : "Keep lessons short";
    },
  },
  { match: (e) => /\b(harder|tougher|tricky|trickier|challenging)\b/i.test(e.instruction), text: () => "Make quiz options harder to tell apart" },
  { match: (e) => /\b(easier|simpler)\b/i.test(e.instruction), text: () => "Keep quizzes simple and direct" },
  { match: (e) => has(e, /^added \d+ checklist/), text: () => "Include a practical checklist step" },
  { match: (e) => has(e, /^added \d+ lesson/), text: () => "Cover more topics with short, separate lessons" },
];

/** Deterministic distiller over the edit signals (offline stand-in and the fallback on failure). */
export function offlinePreferences(edits: EditEvidence[]): Preference[] {
  const out: Preference[] = [];
  for (const rule of RULES) {
    const hits = edits.filter(rule.match);
    if (hits.length) out.push({ text: rule.text(hits), evidence_edit_ids: hits.map((e) => e.id) });
  }
  return out.slice(0, MAX_PREFERENCES);
}
