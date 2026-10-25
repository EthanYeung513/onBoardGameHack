import type { CoursePack } from "@/lib/flow/course-packs";
import { TEACHING_KINDS, type CourseOption, type CourseSpec, type CourseStep } from "@/lib/flow/course-spec";

// Offline stand-in for `generate_courses` (no MUBIT_API_KEY): a deterministic course assembled
// only from approved facts — one lesson per category group, fill-the-blank quizzes cut from the
// fact text with distractors taken from other facts. Nothing is invented; the course row is
// labelled `mode: "offline"` and the scan log says so.

export interface CourseFact {
  id: string;
  category: string;
  text: string;
  confidence: number;
}

const FACTS_PER_LESSON = 4;
const MAX_LESSONS = 4;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30) || "step";

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Proper nouns, quoted terms and #channels — the words worth blanking out of a fact. */
export function keyTerms(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"([^"]{2,40})"|(#[a-z0-9-]{2,30})|\b([A-Z][A-Za-z0-9]{2,})\b/g)) {
    const term = m[1] ?? m[2] ?? m[3];
    if (m[3] && m.index === 0) continue; // a capital at the start of the sentence is not a name
    if (term && !out.some((t) => t.toLowerCase() === term.toLowerCase())) out.push(term);
  }
  return out;
}

/** "___ owns the deploy pipeline." with the real term and up to two terms from other facts. */
export function blankQuiz(fact: CourseFact, pool: CourseFact[], id: string): CourseStep | null {
  const answer = keyTerms(fact.text)[0];
  if (!answer) return null;
  const lower = fact.text.toLowerCase();
  const distractors: string[] = [];
  for (const other of pool) {
    if (other.id === fact.id) continue;
    for (const term of keyTerms(other.text)) {
      const t = term.toLowerCase();
      if (t === answer.toLowerCase() || lower.includes(t) || distractors.some((d) => d.toLowerCase() === t)) continue;
      distractors.push(term);
      break;
    }
    if (distractors.length === 2) break;
  }
  if (distractors.length === 0) return null;
  const why = clip(fact.text, 300);
  const options: CourseOption[] = distractors.map((label) => ({ label, correct: false, why }));
  options.splice(hash(fact.id) % (options.length + 1), 0, { label: answer, correct: true, why });
  return {
    id,
    kind: "quiz",
    title: "Fill the blank",
    body: clip(fact.text.replace(answer, "_____"), 1500),
    options,
    teaches_fact_ids: [fact.id],
  };
}

function lessonsFor(pack: CoursePack, facts: CourseFact[]) {
  const groups: { title: string; facts: CourseFact[] }[] = [];
  for (const category of pack.categories) {
    const inCat = facts.filter((f) => f.category === category);
    for (let i = 0; i < inCat.length && groups.length < MAX_LESSONS; i += FACTS_PER_LESSON) {
      const part = inCat.slice(i, i + FACTS_PER_LESSON);
      groups.push({ title: i === 0 ? category : `${category} (${i / FACTS_PER_LESSON + 1})`, facts: part });
    }
  }
  return groups;
}

const lessonBody = (facts: CourseFact[]) => clip(facts.map((f) => f.text).join("\n"), 1500);

/** The whole course for one pack; `pool` is every approved fact of the space (quiz distractors). */
export function offlineCourse(pack: CoursePack, facts: CourseFact[], pool: CourseFact[]): CourseSpec {
  const steps: CourseStep[] = [{ id: "welcome", kind: "welcome", title: `Welcome to ${pack.title}`, body: pack.desc, teaches_fact_ids: [] }];
  for (const group of lessonsFor(pack, facts)) {
    const id = slug(group.title);
    steps.push({ id, kind: "lesson", title: group.title, body: lessonBody(group.facts), teaches_fact_ids: group.facts.map((f) => f.id) });
    const quiz = blankQuiz(group.facts[0], pool, `${id}-quiz`);
    if (quiz) steps.push(quiz);
  }
  steps.push({ id: "done", kind: "done", title: "You're all set.", body: `${pack.building} badge unlocked.`, teaches_fact_ids: [] });
  return { title: pack.title, icon: pack.icon, building: pack.building, game: pack.game, desc: pack.desc, steps };
}

export type StepRefresh = { steps: CourseStep[]; remove: string[] };

/**
 * Offline step refresh: keep each stale step's still-approved citations and rebuild it from them;
 * a step left with nothing approved to teach is removed. Non-teaching steps are kept as they are.
 */
export function offlineStepRefresh(spec: CourseSpec, stepIds: string[], approved: Map<string, CourseFact>): StepRefresh {
  const steps: CourseStep[] = [];
  const remove: string[] = [];
  for (const step of spec.steps.filter((s) => stepIds.includes(s.id))) {
    if (!TEACHING_KINDS.includes(step.kind)) {
      steps.push({ ...step, teaches_fact_ids: step.teaches_fact_ids.filter((id) => approved.has(id)) });
      continue;
    }
    const facts = step.teaches_fact_ids.map((id) => approved.get(id)).filter((f): f is CourseFact => Boolean(f));
    if (facts.length === 0) {
      remove.push(step.id);
      continue;
    }
    if (step.kind === "lesson") {
      steps.push({ ...step, body: lessonBody(facts), teaches_fact_ids: facts.map((f) => f.id) });
    } else {
      // A quiz/scenario whose fact is still approved keeps its wording; drop citations that went stale.
      steps.push({ ...step, teaches_fact_ids: facts.map((f) => f.id) });
    }
  }
  return { steps, remove };
}
