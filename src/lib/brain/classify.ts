import { z } from "zod";

// Brain triage (task `brain_classify`): one cheap Mubit call labels many passages before extraction.
//   high → extracted first; low → extracted after every high passage (in the background on a
//   scan's first pass); skip → recorded as skipped (audit row with the reason), never extracted.

export const BRAIN_LABELS = ["high", "low", "skip"] as const;
export type BrainLabel = (typeof BRAIN_LABELS)[number];

export const Classification = z.object({
  results: z.array(
    z.object({
      id: z.string().trim().min(1),
      value: z.enum(BRAIN_LABELS),
      /** A few words, kept on skipped passages' audit rows. */
      reason: z.string().trim().max(80).default(""),
    }),
  ),
});
export type Classification = z.infer<typeof Classification>;

/** Passage text sent to the classifier: enough to judge, small enough for 50 per call. */
export const CLASSIFY_PREVIEW_CHARS = 600;

export interface ClassifyInput {
  text: string;
  title: string;
  kind: string;
  connectorType: string;
}

/** Everything that varies goes in the user message (AGENTS.md "Model boundaries"). */
export function classifyUserMessage(items: ClassifyInput[], company: string) {
  return [
    `Company: ${company}`,
    ...items.map((c, i) => {
      const t = c.text.replace(/\s+/g, " ").trim();
      const preview = t.length > CLASSIFY_PREVIEW_CHARS ? `${t.slice(0, CLASSIFY_PREVIEW_CHARS)} [...${t.length - CLASSIFY_PREVIEW_CHARS} more chars]` : t;
      return `### id: c${i + 1}\nSource: ${c.connectorType} ${c.kind} | ${c.title}\n${preview}`;
    }),
  ].join("\n\n");
}

const BOILERPLATE =
  /\b(cookie|cookies|privacy policy|terms of (service|use)|all rights reserved|accept all|manage preferences|consent|gdpr|subscribe to our newsletter|sign up for (our|the) newsletter|copyright ©|©\s?\d{4})\b/i;
const CONTENT_SIGNAL =
  /\b(owns?|owner|responsible|team|we use|uses?|policy|must|required|every (monday|tuesday|wednesday|thursday|friday|week|day|sprint|quarter)|weekly|daily|on-?call|deploy|release|onboarding|founded|headquarter|mission|values?|customers?|product|platform|api|integrat\w*|handbook|process|review|approve|security|support)\b/i;

/**
 * OFFLINE STAND-IN for `brain_classify`: a rule-based triage (labelled offline in the audit rows).
 * Link lists, boilerplate and near-empty passages are skipped; passages with ownership, tooling,
 * policy or ritual signals are high; the rest are low.
 */
export function offlineClassify(c: Pick<ClassifyInput, "text">): { value: BrainLabel; reason: string } {
  const text = c.text.trim();
  const words = text.match(/[A-Za-z][A-Za-z'-]+/g) ?? [];
  if (words.length < 8) return { value: "skip", reason: "too short to hold a fact" };
  const lines = text.split("\n").filter((l) => l.trim());
  const linkish = lines.filter((l) => /^\s*([-*]\s*)?\[[^\]]*\]\([^)]*\)\s*$/.test(l) || /^\s*[-*]\s*\S+(\s\S+){0,3}\s*$/.test(l)).length;
  if (lines.length >= 4 && linkish / lines.length > 0.7) return { value: "skip", reason: "navigation or link list" };
  if (BOILERPLATE.test(text) && (text.length < 400 || !CONTENT_SIGNAL.test(text.replace(new RegExp(BOILERPLATE.source, "gi"), "")))) return { value: "skip", reason: "legal or cookie boilerplate" };
  if (CONTENT_SIGNAL.test(text)) return { value: "high", reason: "names owners, tools, rules or rituals" };
  return { value: "low", reason: "general copy" };
}

/** Whitespace/case-insensitive key: identical passages (repeated footers, shared sections) are classified once. */
export const passageKey = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
