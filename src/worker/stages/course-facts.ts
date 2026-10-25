import { api } from "@convex/_generated/api";
import { MIN_FACTS_PER_COURSE, type CoursePack } from "@/lib/flow/course-packs";
import type { StageContext } from "../types";
import type { CourseFact } from "./course-offline";

// Which approved facts a course teaches. Default packs take their brain categories first; a
// manager-named topic (F22), or a pack whose categories the brain barely has, takes the facts most
// relevant to it: keyword match over every approved fact, plus Convex full text and vector search
// over the chunks facts cite (courseGen.topicFacts), re-ranked by embedding similarity to the topic.
// Nothing is padded: a fact counts only when it matches a topic word or is semantically close.

/**
 * Live embeddings (text-embedding-3-large): below this cosine a fact without a topic word isn't
 * about the topic. Measured on a linear.app brain: unrelated topics ("Hiring and interviews",
 * "Cooking") peak at 0.31, real matches ("Pricing" → plan prices) sit at 0.34 and above.
 */
export const LIVE_MIN_SIMILARITY = 0.33;
/** Candidates re-ranked by embedding per course (one batched embed call). */
const MAX_CANDIDATES = 60;

const STOPWORDS = new Set(
  "the and for with our your how what why who when about into from that this best practice practices basics basic guide intro introduction fundamentals overview 101 work working company team new hire hires onboarding course training essentials tips rules"
    .split(" "),
);

/** Lowercase stems of the topic's meaningful words ("Security best practices" → ["secur"]). */
export function topicTerms(topic: string): string[] {
  const words = topic.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const stems = words
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w))
    .map((w) => (w.length > 5 ? w.replace(/(ities|ity|ies|ing|ion|ions|ed|es|s|y)$/, "") : w))
    .map((w) => (w.length > 7 ? w.slice(0, 7) : w));
  return [...new Set(stems)].slice(0, 8);
}

/** Share of the topic's terms the fact mentions (its category counts as text too). */
export function keywordScore(fact: Pick<CourseFact, "text" | "category">, terms: string[]): number {
  if (terms.length === 0) return 0;
  const text = `${fact.category} ${fact.text}`.toLowerCase();
  return terms.filter((t) => new RegExp(`\\b${t}`).test(text)).length / terms.length;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface TopicSignals {
  /** Fact id → embedding similarity to the topic (only for candidates that were embedded). */
  similarity: Map<string, number>;
  /** Fact ids Convex full text matched. */
  lexical: Set<string>;
  /** Similarity at or above which a fact counts as relevant; Infinity = keywords only. */
  minSimilarity: number;
}

/** The relevant facts, most relevant first. Pure, so the ranking is unit-tested without providers. */
export function rankTopicFacts(topic: string, facts: CourseFact[], signals: TopicSignals, limit: number): CourseFact[] {
  const terms = topicTerms(topic);
  // A short topic ("Security") matches on any of its words; a long description needs a third.
  const minKeyword = terms.length <= 3 ? Number.MIN_VALUE : 1 / 3;
  return facts
    .map((f) => {
      const kw = keywordScore(f, terms);
      const sim = signals.similarity.get(f.id) ?? 0;
      const relevant = (kw > 0 && kw >= minKeyword) || sim >= signals.minSimilarity;
      return { f, relevant, score: sim + 0.25 * kw + (signals.lexical.has(f.id) ? 0.05 : 0) + 0.01 * f.confidence };
    })
    .filter((x) => x.relevant)
    .sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id))
    .slice(0, limit)
    .map((x) => x.f);
}

/** Retrieval + re-rank for one topic: 2 to 3 short round trips, no LLM call. */
/**
 * `relaxed`: the manager asked for this course by name, so it is always built. When few facts clear
 * the relevance bar, take the closest ones the brain has (still only real, approved facts).
 */
export async function selectTopicFacts(ctx: StageContext, topic: string, facts: CourseFact[], limit: number, relaxed = false): Promise<CourseFact[]> {
  const terms = topicTerms(topic);
  const byId = new Map(facts.map((f) => [f.id, f]));
  // An embedding outage degrades to keyword + full-text relevance; it never fails the course.
  const vector = await ctx.embed.embed([topic]).then(([v]) => v, () => undefined);
  const found = ctx.convex.action
    ? await ctx.convex.action(api.courseGen.topicFacts, { spaceId: ctx.space._id, q: terms.join(" ") || topic, vector })
    : { lexical: [], semantic: [] };
  const lexical = new Set(found.lexical.filter((id) => byId.has(id)));
  const keyword = facts.filter((f) => keywordScore(f, terms) > 0).map((f) => f.id);
  const matched = [...new Set([...keyword, ...lexical, ...found.semantic.map((s) => s.factId).filter((id) => byId.has(id))])];
  // Relaxed with few matches: every approved fact is a candidate, ranked by closeness to the topic.
  const pool = relaxed && matched.length < limit ? [...new Set([...matched, ...facts.map((f) => f.id)])] : matched;
  const candidates = pool.slice(0, MAX_CANDIDATES);
  const similarity = new Map<string, number>();
  const vectors = vector && candidates.length ? await ctx.embed.embed(candidates.map((id) => byId.get(id)!.text)).catch(() => null) : null;
  if (vector && vectors) candidates.forEach((id, i) => similarity.set(id, cosine(vector, vectors[i])));
  // Offline (hashed bag-of-words) vectors only reflect shared words: keywords decide there.
  const minSimilarity = relaxed ? Number.NEGATIVE_INFINITY : ctx.embed.mode === "live" && vectors ? LIVE_MIN_SIMILARITY : Number.POSITIVE_INFINITY;
  return rankTopicFacts(topic, candidates.map((id) => byId.get(id)!), { similarity, lexical, minSimilarity }, limit);
}

/** A default pack's own categories, best first (pure). */
export function factsForPack(pack: CoursePack, facts: CourseFact[], limit: number): CourseFact[] {
  const rank = (f: CourseFact) => pack.categories.indexOf(f.category as CoursePack["categories"][number]);
  return facts
    .filter((f) => rank(f) >= 0)
    .sort((a, b) => rank(a) - rank(b) || b.confidence - a.confidence || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** What a pack's facts are retrieved by when its categories are thin. */
export const packQuery = (pack: CoursePack) => pack.topic ?? `${pack.title}: ${pack.desc} ${pack.lessons.join(", ")}`;

/**
 * The facts one course is built from. Topic packs: relevance only. Default packs: their categories,
 * topped up by relevance when the brain has few facts in them (a brain that is mostly "Product"
 * still gives every course real content).
 */
export async function factsForCourse(ctx: StageContext, pack: CoursePack, facts: CourseFact[], limit: number): Promise<CourseFact[]> {
  if (pack.topic) return selectTopicFacts(ctx, pack.topic, facts, limit);
  const own = factsForPack(pack, facts, limit);
  if (own.length >= MIN_FACTS_PER_COURSE) return own;
  const extra = await selectTopicFacts(ctx, packQuery(pack), facts, limit);
  return [...new Map([...own, ...extra].map((f) => [f.id, f])).values()].slice(0, limit);
}
