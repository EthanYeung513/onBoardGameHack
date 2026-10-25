import { battleSpecSchema, BATTLE_ARENAS, type BattleArena } from "@/games/battle/spec";
import type { GameId } from "@/games/core/types";
import { dilemmaSpecSchema } from "@/games/dilemma/spec";
import { CHARACTER_IDS } from "@/games/dilemma/sprites";
import { wordMatchSpecSchema } from "@/games/word-match/spec";
import { stripEmDashDeep } from "@/lib/emdash";
import { WORLD_VERSION, type WorldCourse, type WorldData, type WorldNpc } from "./contract";

// Course content → the hire's world (D-35). Pure templating, no model call, so Generate → link
// stays in seconds: each course becomes a building, its steps and the brain facts it teaches
// become that building's game (battle, Ace Attorney dilemma or word match), validated against the
// game's own schema. Built on every request from live data, so when a connected source changes
// and the brain/courses refresh, the world the hire plays changes with them.

export interface WorldInput {
  space: { name: string; host: string; mode?: "live" | "offline" };
  brand: { primary?: string; accent?: string; surface?: string; text?: string; headingFont?: string; bodyFont?: string; logoUrl?: string | null } | null;
  courses: { packType: string; title: string; desc?: string; building?: string; spec: unknown; staleSteps?: number }[];
  facts: { id?: string; text: string; category: string; entityName?: string; entityType?: string }[];
  rewards: { name: string; costCoins: number }[];
  generatedAt: number;
}

type Step = { id: string; kind: string; title: string; body?: string; options?: { label: string; correct?: boolean; why?: string }[]; teaches_fact_ids?: string[] };
type Fact = WorldInput["facts"][number];

const steps = (spec: unknown): Step[] => {
  const s = (spec as { steps?: unknown })?.steps;
  return Array.isArray(s) ? (s as Step[]).filter((x) => x && typeof x.title === "string") : [];
};

/** Shortens to `max` characters at a word boundary (never mid-word), with an ellipsis. */
export function fit(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  // Ends on a whole word when the next character is a space; otherwise back up to the last space.
  const at = t[max - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

const slug = (s: string, i: number) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "item"}-${i}`;

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** Deterministic pick so the same content always yields the same world. */
const pickFrom = <T,>(items: readonly T[], seed: string, n = 0): T => items[(hash(seed) + n) % items.length];

const ARENA_BY_PACK: Record<string, BattleArena> = { company: "city", people: "meadow", tools: "cave", hard: "haunted", security: "haunted", product: "beach" };
const arenaFor = (packType: string): BattleArena => Object.entries(ARENA_BY_PACK).find(([k]) => packType.includes(k))?.[1] ?? pickFrom(BATTLE_ARENAS, packType);
/** Gen 1–5 opponents with animated sprites: Gengar, Snorlax, Dragonite, Mewtwo, Tyranitar, Garchomp, Lucario, Zoroark. */
const OPPONENTS = [94, 143, 149, 150, 248, 445, 448, 571];

// ---- question sources -----------------------------------------------------------------------

interface Question { id: string; prompt: string; choices: string[]; answer: number; explanation: string }

/** The question a step asks: course steps often title it "Quick check" and ask in the body. */
const askOf = (s: Step) => (s.body && (s.body.includes("?") || s.title.length < 24) ? s.body : s.title);

/** Course quiz steps → questions. Only steps whose answers fit the battle's 48-character moves
 * whole: longer answers read as sentences and play as dilemma scenes instead. */
function quizQuestions(course: WorldInput["courses"][number]): Question[] {
  return steps(course.spec)
    .filter((s) => (s.kind === "quiz" || s.kind === "scenario") && (s.options?.length ?? 0) >= 2)
    .filter((s) => s.options!.slice(0, 4).every((o) => o.label.trim().length <= 48))
    .flatMap((s, i) => {
      const opts = s.options!.slice(0, 4);
      const answer = opts.findIndex((o) => o.correct);
      if (answer < 0) return [];
      const choices = opts.map((o) => o.label.trim());
      if (new Set(choices).size !== choices.length) return [];
      const why = opts[answer].why ?? s.body ?? `The answer is: ${opts[answer].label}`;
      return [{ id: slug(s.id, i), prompt: fit(askOf(s), 180), choices, answer, explanation: fit(why, 220) }];
    });
}

/** "Who/what is this?" rounds from facts about named entities: the name is masked in the fact. */
/** The fact with the name blanked: case-sensitive, whole word, so "Payments" doesn't blank "payments". */
const mask = (f: Fact) => f.text.replace(new RegExp(`(?<![\\w])${f.entityName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g"), "___");

/** Names worth learning: proper names, not the company itself or generic words like "team". */
const learnable = (f: Fact, company: string) =>
  !!f.entityName && f.entityName.length <= 40 && /[A-Z0-9@]/.test(f.entityName) && f.entityName.toLowerCase() !== company.toLowerCase() && mask(f) !== f.text;


function entityQuestions(facts: Fact[], seed: string, company: string): Question[] {
  const named = facts.filter((f) => learnable(f, company));
  const names = [...new Set(named.map((f) => f.entityName!))];
  if (names.length < 3) return [];
  return named.slice(0, 12).flatMap((f, i) => {
    const masked = mask(f);
    const others = names.filter((n) => n !== f.entityName);
    const distractors = [0, 1, 2].map((k) => pickFrom(others, f.text, k)).filter((n, j, a) => a.indexOf(n) === j);
    const choices = [f.entityName!, ...distractors].slice(0, 4);
    if (choices.length < 2) return [];
    // Place the right answer deterministically, not always first.
    const at = hash(seed + f.text) % choices.length;
    [choices[0], choices[at]] = [choices[at], choices[0]];
    return [{ id: slug(f.entityName!, i), prompt: fit(`Fill the blank: ${masked}`, 180), choices: choices.map((c) => fit(c, 48)), answer: at, explanation: fit(f.text, 220) }];
  });
}

// ---- games ------------------------------------------------------------------------------------

function battle(course: WorldInput["courses"][number], facts: Fact[], company: string) {
  const rounds = [...quizQuestions(course), ...entityQuestions(facts, course.packType, company)].slice(0, 10);
  if (rounds.length < 3) return null;
  const words = course.title.split(/\s+/).filter((w) => w.length > 2);
  return battleSpecSchema.safeParse({
    title: fit(course.title, 80),
    intro: fit(course.desc ?? `Answer right to land a hit. Everything here is how ${company} really works.`, 300),
    opponent: { name: fit((words[0] ?? "Boss").toUpperCase(), 16), pokemon: pickFrom(OPPONENTS, course.packType), level: 30 + rounds.length, moves: ["Wrong Turn", "Old Docs", "Hot Take"] },
    player: { name: "NEW JOINER", pokemon: 25, level: 30 },
    arena: arenaFor(course.packType),
    lives: 3,
    rounds,
  });
}

function wordMatch(course: WorldInput["courses"][number], facts: Fact[], company: string) {
  const seen = new Set<string>();
  const pairs = facts
    .filter((f) => learnable(f, company))
    .filter((f) => !seen.has(f.entityName!.toLowerCase()) && seen.add(f.entityName!.toLowerCase()))
    .map((f, i) => ({ id: slug(f.entityName!, i), term: f.entityName!, meaning: fit(mask(f), 120) }))
    .filter((p) => p.meaning.length >= 3)
    .slice(0, 16);
  const meanings = new Set<string>();
  const unique = pairs.filter((p) => !meanings.has(p.meaning.toLowerCase()) && meanings.add(p.meaning.toLowerCase()));
  if (unique.length < 4) return null;
  return wordMatchSpecSchema.safeParse({
    title: fit(course.title, 80),
    intro: fit(course.desc ?? "Match each name to what it means here. Chain correct matches for a combo.", 300),
    boardSize: 4,
    timeLimitSec: 60,
    lives: 5,
    pairs: unique,
  });
}

const OPENERS = ["Hey, got a minute? I need your call on something.", "Quick one before standup. What would you do here?", "New joiner question, and it matters. Ready?"];

function dilemma(course: WorldInput["courses"][number], people: WorldNpc[]) {
  const scenarioSteps = steps(course.spec).filter((s) => (s.kind === "scenario" || s.kind === "quiz") && (s.options?.length ?? 0) >= 2 && s.options!.some((o) => o.correct));
  if (!scenarioSteps.length) return null;
  const castChars = CHARACTER_IDS.filter((c) => c !== "phoenix" && c !== "judge");
  const cast = (people.length ? people : [{ name: "Alex", role: "Teammate", facts: [] }]).slice(0, 3).map((p, i) => ({
    id: `p${i}`,
    name: fit(p.name, 18),
    role: fit(p.role, 40),
    voice: (["mid", "high", "low"] as const)[i % 3],
    character: castChars[i % castChars.length],
  }));
  const scenes = scenarioSteps.slice(0, 5).map((s, i) => {
    const speaker = cast[i % cast.length].id;
    const opts = s.options!.slice(0, 4);
    const best = opts.find((o) => o.correct)!;
    return {
      id: slug(s.id, i),
      title: fit(s.title, 40),
      setting: (["office", "meeting-room", "video-call", "reception"] as const)[i % 4],
      lines: [{ speaker, text: fit(s.body && askOf(s) !== s.body ? s.body : pickFrom(OPENERS, s.id), 220), mood: "thinking" as const }],
      question: { speaker, text: fit(askOf(s), 220), mood: "neutral" as const },
      options: opts.map((o) => ({
        text: fit(o.label, 110),
        verdict: o.correct ? ("best" as const) : ("wrong" as const),
        response: [{ speaker, text: o.correct ? "That's exactly how we do it here." : "Hmm. That's not how it works here.", mood: o.correct ? ("happy" as const) : ("shocked" as const) }],
        feedback: fit(o.why ?? (o.correct ? `Right: ${best.label}` : `The better call: ${best.label}`), 240),
      })),
    };
  });
  return dilemmaSpecSchema.safeParse({ title: fit(course.title, 80), intro: fit(course.desc ?? "Say the right thing when it counts.", 300), cast, scenes, credibility: 4 });
}

/** Which game a course plays: judgment calls → dilemma, names and faces → word match, the rest →
 * battle, so a standard curriculum puts all three games in the town. Falls back down the list. */
export function preferredGames(course: WorldInput["courses"][number]): GameId[] {
  const p = course.packType;
  if (/hard|scenario|security|compliance|conduct/.test(p)) return ["dilemma", "battle", "word-match"];
  if (/people|culture|team|glossary/.test(p)) return ["word-match", "battle", "dilemma"];
  if (!/company|tools|stack|product/.test(p) && steps(course.spec).filter((s) => s.kind === "scenario").length >= 2) return ["dilemma", "battle", "word-match"];
  return ["battle", "word-match", "dilemma"];
}

/** Facts a course teaches: the ones its steps cite first (so a refreshed step's new fact reaches
 * the game), then facts naming things the course mentions, else the whole brain. */
function courseFacts(course: WorldInput["courses"][number], facts: Fact[]): Fact[] {
  const cited = new Set(steps(course.spec).flatMap((s) => s.teaches_fact_ids ?? []));
  const taught = facts.filter((f) => f.id && cited.has(f.id));
  const text = steps(course.spec).map((s) => `${s.title} ${s.body ?? ""}`).join(" ").toLowerCase();
  const mentioned = facts.filter((f) => !taught.includes(f) && f.entityName && text.includes(f.entityName.toLowerCase()));
  const own = [...taught, ...mentioned];
  return own.length >= 4 ? own : facts;
}

function npcsFrom(facts: Fact[]): WorldNpc[] {
  const byPerson = new Map<string, WorldNpc>();
  for (const f of facts) {
    if (f.entityType !== "person" || !f.entityName) continue;
    const npc = byPerson.get(f.entityName) ?? { name: f.entityName, role: f.category, facts: [] };
    if (npc.facts.length < 3) npc.facts.push(fit(f.text, 200));
    byPerson.set(f.entityName, npc);
  }
  return [...byPerson.values()].slice(0, 6);
}

export function buildWorld(input: WorldInput): WorldData {
  const company = input.space.name;
  const people = npcsFrom(input.facts);
  const courses: WorldCourse[] = input.courses.map((c) => {
    // The course's own facts first; a course with too few named ones draws on the whole brain.
    for (const facts of [courseFacts(c, input.facts), input.facts]) {
      for (const game of preferredGames(c)) {
        const r = game === "battle" ? battle(c, facts, company) : game === "word-match" ? wordMatch(c, facts, company) : dilemma(c, people);
        if (r?.success) return { id: c.packType, name: c.title, desc: c.desc, building: c.building, game, spec: r.data, staleSteps: c.staleSteps || undefined };
      }
    }
    // Not enough content for any game yet: the world shows the building as "being rebuilt".
    return { id: c.packType, name: c.title, desc: c.desc, building: c.building, game: "battle", spec: null, staleSteps: c.staleSteps || undefined };
  });
  const b = input.brand ?? {};
  return stripEmDashDeep({
    version: WORLD_VERSION,
    company: { name: company, host: input.space.host, logoUrl: b.logoUrl ?? null },
    brand: {
      primary: b.primary ?? "#2f6bff",
      accent: b.accent ?? "#ff5c39",
      surface: b.surface ?? "#ffffff",
      text: b.text ?? "#101014",
      headingFont: b.headingFont ?? "Inter",
      bodyFont: b.bodyFont ?? "Inter",
    },
    courses,
    npcs: people,
    facts: input.facts.slice(0, 40).map((f) => fit(f.text, 200)),
    rewards: input.rewards.slice(0, 8).map((r, i) => ({ id: `r${i + 1}`, name: r.name, cost: r.costCoins })),
    offline: input.space.mode === "offline",
    generatedAt: new Date(input.generatedAt).toISOString(),
  });
}
