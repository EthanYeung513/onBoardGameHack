import type { GameId } from "@/games/core/types";
import { battleThemeFor } from "./offline-battle-theme";
import type { GenerateGameInput } from "./generate-game";
import { kebab, sectionRules } from "./offline-generate";

/**
 * Deterministic game writer for offline mode. Builds a valid spec for each installed game from the course
 * sections' own rules, so a generated game's dialogue always reflects the current course content.
 */
export function offlineGenerateGame(meta: unknown): { game: GameId; spec: unknown } {
  const input = meta as GenerateGameInput;
  const game = input.game ?? pickGameFor(input);
  const spec = game === "word-match" ? wordMatch(input) : game === "dilemma" ? dilemma(input) : battle(input);
  return { game, spec };
}

/* Content-driven pick when the caller doesn't name a game: one building = one course = one style.
   Judgment/scenario courses suit the courtroom; vocabulary-heavy courses the arcade; the rest battle. */
const DILEMMA_HINTS = /securit|compliance|polic|conduct|ethic|customer|support|incident|escalat|phish|privacy|protect|legal|\bhr\b|people|safety/i;
const WORD_MATCH_HINTS = /glossar|vocab|jargon|terminolog|engineering|technical|\bapi\b|systems?|tools?|platform|architect|payments|ledger|onboard/i;

function pickGameFor(input: GenerateGameInput): GameId {
  const text = [input.packTitle, ...(input.sections ?? []).map((s) => `${s.doc} ${s.heading}`)].join(" ");
  if (DILEMMA_HINTS.test(text)) return "dilemma";
  if (WORD_MATCH_HINTS.test(text)) return "word-match";
  return "battle";
}

/** Words that read as unfinished when a phrase ends on them. */
const DANGLING = new Set("a an the and or but of to in on at for with from by is are be our your their its".split(" "));

/**
 * Short labels (titles, names, terms): the longest run of whole words that fits, never cut mid-word and never
 * ending on a dangling word or punctuation. Generated copy must read as written, so there is no "…".
 */
function fitWords(s: string, max: number): string {
  const text = s.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const words = text.slice(0, max + 1).split(" ");
  if (words.length > 1) words.pop();
  while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ""))) words.pop();
  const out = words.join(" ").replace(/[\s,;:.\u2013\u2014-]+$/, "");
  return out.length <= max && out ? out : text.slice(0, max);
}

const sentencesOf = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Prose that must fit `max`: the whole text, else as many leading whole sentences as fit, else the first sentence
 * ended early at a clause boundary (", ", "; ", ": ", " — "). Null when nothing reads as a complete thought.
 */
function fitText(text: string, max: number): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = sentencesOf(clean);
  let out = "";
  for (const sentence of sentences) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const first = sentences[0] ?? clean;
  const cuts = [...first.matchAll(/[,;:]\s|\s[\u2013\u2014]\s/g)].map((m) => m.index).filter((i) => i + 1 <= max && i >= max / 3);
  if (!cuts.length) return null;
  return `${first.slice(0, cuts[cuts.length - 1]).trimEnd()}.`;
}

/** One sentence of course content: the unit every generated question and line is built from. */
interface Fact {
  doc: string;
  heading: string;
  text: string;
}

function factsOf(input: GenerateGameInput): Fact[] {
  return input.sections.flatMap((s) =>
    sectionRules(s.text).flatMap((rule) => sentencesOf(rule).map((text) => ({ doc: s.doc, heading: s.heading, text }))),
  );
}

const DECOYS = ["Skip it when you're busy", "Do whatever feels fastest", "Wait for a colleague to handle it", "Ignore it this once"];

/** Battle moves are buttons: the spec allows 48 characters and the 2x2 grid wraps them to at most four lines on a phone. */
const MOVE_MAX = 48;
const PROMPT_MAX = 180;

/**
 * Splits a sentence too long to be a move into a stem (asked in the text box) and an ending (the move). Prefers to
 * split at a clause boundary; otherwise the longest whole-word ending that fits.
 */
function clozeOf(text: string): { stem: string; ending: string } | null {
  const words = text.replace(/[.!?]$/, "").split(" ");
  let fallback: { stem: string; ending: string } | null = null;
  for (let k = 3; k <= words.length - 2; k++) {
    const stem = words.slice(0, k).join(" ");
    const ending = words.slice(k).join(" ");
    if (ending.length > MOVE_MAX || DANGLING.has(words[k - 1].toLowerCase())) continue;
    if (/[,;:]$/.test(stem) || /^[\u2013\u2014]/.test(ending)) return { stem: stem.replace(/[,;:]$/, ""), ending: ending.replace(/^[\u2013\u2014]\s*/, "") };
    fallback ??= { stem, ending };
  }
  return fallback;
}

type BattleItem = Fact & { kind: "rule" | "cloze"; correct: string; prompt: string };

function battleItems(input: GenerateGameInput): BattleItem[] {
  return factsOf(input).flatMap((f): BattleItem[] => {
    if (f.text.length <= MOVE_MAX) {
      const prompt = `Per "${f.heading}", which is the right call?`;
      return prompt.length <= PROMPT_MAX ? [{ ...f, kind: "rule", correct: f.text, prompt }] : [];
    }
    const cloze = clozeOf(f.text);
    if (!cloze) return [];
    const prompt = `Finish the line from "${f.heading}": "${cloze.stem} ___"`;
    return prompt.length <= PROMPT_MAX ? [{ ...f, kind: "cloze", correct: cloze.ending, prompt }] : [];
  });
}

function battle(input: GenerateGameInput) {
  const items = battleItems(input);
  const endings = items.filter((it) => it.kind === "cloze").map((it) => it.correct);
  const rounds = items.slice(0, 8).map((item, i) => {
    const correct = item.correct;
    // A missing line's wrong answers are other lines' endings from the course: same shape, plainly not this rule.
    const others = item.kind === "cloze" ? endings.filter((e) => e !== correct) : [];
    const offset = others.length ? i % others.length : 0;
    const pool = [...others.slice(offset), ...others.slice(0, offset), ...DECOYS];
    const wrong = [...new Set(pool.filter((d) => d !== correct))].slice(0, 3);
    const answer = i % (wrong.length + 1);
    const choices = [...wrong.slice(0, answer), correct, ...wrong.slice(answer)];
    return {
      id: `r${i}`,
      prompt: item.prompt,
      choices,
      answer,
      // The doc is cited by `source`, which the results card shows on its own line, so the explanation doesn't repeat it.
      explanation: fitText(`"${item.heading}": ${item.text}`, 220) ?? `It's in "${fitWords(item.heading, 200)}".`,
      source: { doc: item.doc, section: item.heading },
    };
  });
  const { arena, opponent } = battleThemeFor(input);
  return {
    title: titleOf(input.packTitle, " battle"),
    intro: quote(`${opponent.name} is loose in `, `${input.packTitle}. Answer with the rule to land a hit.`, 300) ?? "Answer with the rule to land a hit.",
    opponent: { ...opponent, level: 30 },
    player: { name: fitWords(input.playerName ?? "NEW JOINER", 16), pokemon: 25, level: 30 },
    arena,
    lives: 3,
    rounds,
  };
}

/** "<course><suffix>" within the 80-character title limit, dropping the suffix before cutting the course name. */
function titleOf(packTitle: string, suffix: string): string {
  const full = `${packTitle}${suffix}`;
  return full.length <= 80 ? full : fitWords(packTitle, 80);
}

/** Capitalised words that start sentences or instructions, not names: never a term on their own or at a term's edge. */
const NOT_TERMS = new Set(
  (
    "a an the and or but of to in on at for with from by as if when while every everyone everything anyone anything all any each no " +
    "not never always only also just do don't does use ask tell make keep get gets report check book submit send share call " +
    "please before after during until once we you your our they their it its this that these those there here who what why how " +
    "is are be can may must should will off about up out over under per via plus"
  ).split(" "),
);

/**
 * Candidate terms for a rule, best first: multi-word names from the rule ("Customer Support", "SOC 2", "Report
 * Phish"), then the section heading, then single names used mid-sentence. A word is only a name when it is
 * capitalised somewhere other than the start of a sentence, or runs into another capitalised word.
 */
function termCandidates(rule: string, heading: string): string[] {
  const tokens = rule.replace(/\*\*/g, "").split(/\s+/).filter(Boolean);
  const runs: { words: string[]; atStart: boolean }[] = [];
  let run: { words: string[]; atStart: boolean } | null = null;
  tokens.forEach((raw, i) => {
    const word = raw.replace(/^[^\w£#]+|[^\w£'-]+$/g, "");
    const atStart = i === 0 || /[.!?:;]$/.test(tokens[i - 1]);
    const named = /^[A-Z]{2,}\d*$/.test(word) || (/^[A-Z]/.test(word) && !NOT_TERMS.has(word.toLowerCase()));
    // Numbers only continue a name ("ISO 27001"), never start one.
    if (named || (run && /^\d+$/.test(word))) {
      if (!run || atStart) runs.push((run = { words: [], atStart }));
      run.words.push(word);
    } else run = null;
    if (/[,.!?:;)]$/.test(raw)) run = null;
  });
  const multi = runs.filter((r) => r.words.length >= 2).map((r) => r.words.join(" "));
  const single = runs.filter((r) => r.words.length === 1 && !r.atStart && r.words[0].length > 2).map((r) => r.words[0]);
  const title = heading.replace(/^\s*[\d.]+\s*/, "").trim();
  return [...new Set([...multi, title, ...single].filter(Boolean).map((t) => fitWords(t, 40)))];
}

function wordMatch(input: GenerateGameInput) {
  const seen = new Set<string>();
  const pairs: { id: string; term: string; meaning: string; source: { doc: string; section: string } }[] = [];
  // Takes the first candidate term not already on the board; terms and meanings must each be distinct.
  const push = (terms: string[], meaning: string, doc: string, section: string) => {
    const term = terms.find((t) => !seen.has(t.toLowerCase()));
    if (!term || seen.has(meaning.toLowerCase()) || pairs.length >= 16) return;
    seen.add(term.toLowerCase());
    seen.add(meaning.toLowerCase());
    pairs.push({ id: kebab(term) || `p${pairs.length}`, term, meaning, source: { doc, section } });
  };
  // Meanings are shown whole on the cards (max 120): each rule as written, else its leading sentences, else skipped.
  const meanings = (text: string) => sectionRules(text).flatMap((rule) => fitText(rule, 120) ?? []);
  for (const s of input.sections) {
    const [meaning] = meanings(s.text);
    if (meaning) push(termCandidates(meaning, s.heading), meaning, s.doc, s.heading);
  }
  // Fewer than four sections: pair the remaining rules of each section under "Spot the rule".
  if (pairs.length < 4) {
    for (const s of input.sections) {
      for (const meaning of meanings(s.text).slice(1, 4)) {
        push([...termCandidates(meaning, s.heading), fitWords(meaning.split(" ").slice(0, 3).join(" "), 40)], meaning, s.doc, s.heading);
      }
    }
  }
  return {
    title: titleOf(`Speak ${input.packTitle}`, ": words you'll hear"),
    intro: "Match each term to its meaning before the clock runs out.",
    boardSize: 4,
    timeLimitSec: 60,
    lives: 5,
    pairs,
  };
}

/** `lead` followed by as much of `rule` as reads complete within `max`; null if not even a clause fits. */
function quote(lead: string, rule: string, max: number): string | null {
  const body = fitText(rule, max - lead.length);
  return body ? `${lead}${body}` : null;
}

function dilemma(input: GenerateGameInput) {
  const CHARACTERS = ["wendy-oldbag", "dee-vasquez", "redd-white", "maya", "judge"] as const;
  const cast = input.sections.slice(0, 6).map((s, i) => ({
    id: `npc${i}`,
    name: `Requester ${i + 1}`,
    role: s.doc,
    voice: (["mid", "high", "low"] as const)[i % 3],
    character: CHARACTERS[i % CHARACTERS.length],
  }));
  const scenes = input.sections.slice(0, 6).map((s, i) => {
    const rule = sectionRules(s.text)[0] ?? s.heading;
    const npc = cast[i].id;
    return {
      id: `s${i}`,
      title: fitWords(s.heading, 40),
      setting: (["office", "meeting-room", "reception", "video-call", "courtroom"] as const)[i % 5],
      lines: [
        { speaker: npc, text: quote(`Quick one — "${s.heading}" says: `, rule, 220) ?? `Quick one — it's about "${fitWords(s.heading, 120)}".`, mood: "neutral" },
        { speaker: "player", text: "(They're asking about a rule from the course.)" },
      ],
      question: { speaker: npc, text: "Can you just skip it this once? I'm in a hurry.", mood: "sweating" },
      options: [
        {
          text: "No — the rule still applies when we're busy.",
          verdict: "best",
          response: [{ speaker: npc, text: "Ugh, fine — I'll do it properly.", mood: "sad" }],
          feedback: `"${fitWords(s.heading, 200)}" applies even under pressure.`,
          source: { doc: s.doc, section: s.heading },
        },
        {
          text: "Let me check with my manager first.",
          verdict: "acceptable",
          response: [{ speaker: npc, text: "Okay, but hurry — the clock's ticking.", mood: "thinking" }],
          feedback: "Escalating is safe, but the rule already tells you the answer.",
          source: { doc: s.doc, section: s.heading },
        },
        {
          text: "Sure, I'll make an exception.",
          verdict: "wrong",
          response: [{ speaker: npc, text: "Great — I knew I could count on you!", mood: "happy" }],
          feedback: quote(`That breaks "${s.heading}": `, rule, 240) ?? `That breaks "${fitWords(s.heading, 200)}".`,
          source: { doc: s.doc, section: s.heading },
        },
      ],
    };
  });
  return {
    title: titleOf(input.packTitle, ": hold your ground"),
    intro: "People will try to talk you into skipping the rules. Don't.",
    player: { name: fitWords(input.playerName ?? "You", 18), character: "phoenix" },
    credibility: 4,
    cast,
    scenes,
  };
}
