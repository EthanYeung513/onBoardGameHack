import type { GenerateInput, GeneratedCard } from "./generate";

const STOPWORDS = new Set(
  "a an the and or but if of to in on at for with from by is are be been it its this that these those you your our we they them their not never always every any all can may must should will".split(" "),
);

export function kebab(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 4)
      .join("-") || "general"
  );
}

/** The rules in a section: its bullet points, or its sentences if it has none. */
export function sectionRules(text: string): string[] {
  const bullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-*]|\d+\.)\s+/.test(l))
    .map((l) => l.replace(/^([-*]|\d+\.)\s+/, "").replace(/\*\*/g, ""));
  if (bullets.length) return bullets;
  return text
    .replace(/\*\*/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}

/** Two distinctive words from each rule, used as the offline grader's signals for generated cards. */
export function signalsFromRules(rules: string[]): string[][] {
  return rules.slice(0, 4).map((rule) =>
    (rule.toLowerCase().match(/[a-z0-9£-]+/g) ?? [])
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
      .sort((a, b) => b.length - a.length)
      .slice(0, 2),
  ).filter((g) => g.length > 0);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Template-based card writer for offline mode. It only rephrases rules from the section, so it never invents
 * policy; a reviewer approves or edits the result like any generated card.
 */
export function offlineGenerate(meta: unknown): GeneratedCard {
  const input = meta as GenerateInput;
  const rules = sectionRules(input.text);
  const first = rules[0] ?? input.heading;
  const competency = kebab(input.heading);
  const expert = `Per "${input.heading}": ${rules.slice(0, 3).join(" ")}`;

  if (input.type === "mcq") {
    return {
      type: "mcq",
      competency,
      prompt: `You're new in ${input.role}. Which of these follows the "${input.heading}" policy?`,
      choices: [first, "Do whatever the person asking needs, to keep them happy", "Wait until a colleague has time to look at it next week", "Skip the step this once if you're busy"],
      answer_idx: 0,
      levels: null,
      expert_answer: expert,
    };
  }
  if (input.type === "phish_email") {
    return {
      type: "phish_email",
      competency,
      prompt: `From: urgent-requests@${kebab(input.packTitle)}-support.example\nSubject: Action needed today\n\nWe need you to skip the usual "${input.heading}" process just this once. Reply within the hour.`,
      choices: ["Phish: report it", "Legit: safe to act on"],
      answer_idx: 0,
      levels: null,
      expert_answer: expert,
    };
  }
  return {
    type: input.type,
    competency,
    prompt: `You're new in ${input.role}. A situation comes up where the rule is that you ${lowerFirst(first).replace(/\.$/, "")}. A colleague under pressure asks you to make an exception. What do you do, and why?`,
    choices: null,
    answer_idx: null,
    levels: {
      "0": "Makes the exception or breaks the policy.",
      "1": "Refuses but can't say what the policy requires.",
      "2": "Follows the main rule but misses a supporting step.",
      "3": `Follows "${input.heading}" fully and explains why.`,
    },
    expert_answer: expert,
  };
}
