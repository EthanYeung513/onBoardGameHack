import type { GradeInput, GradeOutput } from "./grade";

/** How close a past ruling must be for the offline grader to copy it. */
export const OFFLINE_RULING_THRESHOLD = 0.6;

function findPhrase(answer: string, phrases: string[]): string | null {
  const lower = answer.toLowerCase();
  for (const phrase of phrases) {
    const i = lower.indexOf(phrase.toLowerCase());
    if (i !== -1) return answer.slice(i, i + phrase.length);
  }
  return null;
}

function openingWords(answer: string, n = 8): string {
  return answer.trim().split(/\s+/).slice(0, n).join(" ");
}

/**
 * The offline stand-in for the frontier grader. It is deliberately generic: it rewards rubric phrases and only
 * docks one point for a red flag, the way a model without company context is lenient. Reviewer rulings on very
 * similar answers override it, which is the fast path working without a network.
 */
export function offlineGrade(meta: unknown): GradeOutput {
  const input = meta as GradeInput;
  const competency = input.rubric.competency;

  const ruling = [...input.corrections].sort((a, b) => b.similarity - a.similarity)[0];
  if (ruling && ruling.similarity >= OFFLINE_RULING_THRESHOLD) {
    const score = ruling.correctedScores[competency] ?? 0;
    return {
      scores: { [competency]: score },
      evidence_quote: openingWords(input.answer),
      feedback: `A reviewer ruled on a very similar answer: ${ruling.reason}`,
      gap: score >= 3 ? "none" : ruling.reason,
    };
  }

  const groups = input.rubric.signals ?? [];
  const hits = groups.map((g) => findPhrase(input.answer, g));
  const matched = hits.filter(Boolean).length;
  let score = groups.length ? Math.round((3 * matched) / groups.length) : 1;
  const redFlag = findPhrase(input.answer, input.rubric.redFlags ?? []);
  if (redFlag) score = Math.max(0, score - 1);

  const missing = groups.find((_, i) => !hits[i]);
  const gap = missing ? `missed: ${missing[0]}` : "none";
  return {
    scores: { [competency]: score },
    evidence_quote: redFlag ?? hits.find(Boolean) ?? openingWords(input.answer),
    feedback: missing ? `Good start. Next time, remember to ${missing[0]}.` : "Well handled: that follows the policy.",
    gap,
  };
}
