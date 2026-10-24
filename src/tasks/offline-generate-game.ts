import type { GameId } from "@/games/core/types";
import type { GenerateGameInput } from "./generate-game";
import { kebab, sectionRules } from "./offline-generate";

/**
 * Deterministic game writer for offline mode. Builds a valid spec for each installed game from the course
 * sections' own rules, so a generated game's dialogue always reflects the current course content.
 */
export function offlineGenerateGame(meta: unknown): { game: GameId; spec: unknown } {
  const input = meta as GenerateGameInput;
  const game = input.game ?? "battle";
  const spec = game === "word-match" ? wordMatch(input) : game === "dilemma" ? dilemma(input) : battle(input);
  return { game, spec };
}

const clamp = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

function rulesOf(input: GenerateGameInput): { doc: string; heading: string; rule: string }[] {
  return input.sections.flatMap((s) => sectionRules(s.text).map((rule) => ({ doc: s.doc, heading: s.heading, rule })));
}

const DECOYS = ["Skip it when you're busy", "Do whatever feels fastest", "Wait for a colleague to handle it", "Ignore it this once"];

function battle(input: GenerateGameInput) {
  const items = rulesOf(input);
  const rounds = items.slice(0, 8).map((item, i) => {
    const correct = clamp(item.rule, 48);
    const wrong = DECOYS.filter((d) => d !== correct).slice(0, 3);
    const answer = i % (wrong.length + 1);
    const choices = [...wrong.slice(0, answer), correct, ...wrong.slice(answer)];
    return {
      id: `r${i}`,
      prompt: clamp(`Per "${item.heading}", which is the right call?`, 180),
      choices,
      answer,
      explanation: clamp(`"${item.heading}" requires this. Source: ${item.doc}.`, 220),
      source: { doc: item.doc, section: item.heading },
    };
  });
  return {
    title: clamp(`${input.packTitle} battle`, 80),
    intro: "Answer with the rule to land a hit.",
    opponent: { name: "SLACKER", pokemon: 96, level: 30, moves: ["Corner Cut", "Vague Ask", "Policy Fog"] },
    player: { name: clamp(input.playerName ?? "NEW JOINER", 16), pokemon: 25, level: 30 },
    lives: 3,
    rounds,
  };
}

function termFor(rule: string, heading: string): string {
  const bold = rule.match(/\*\*(.+?)\*\*/)?.[1];
  if (bold) return clamp(bold, 40);
  const words = rule
    .replace(/\*\*/g, "")
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && w.length > 2)
    .slice(0, 3);
  return clamp(words.length ? words.join(" ") : heading, 40);
}

function wordMatch(input: GenerateGameInput) {
  const seen = new Set<string>();
  const pairs: { id: string; term: string; meaning: string; source: { doc: string; section: string } }[] = [];
  const push = (term: string, meaning: string, doc: string, section: string) => {
    const key = term.toLowerCase();
    if (seen.has(key) || pairs.length >= 16) return;
    seen.add(key);
    pairs.push({ id: kebab(term) || `p${pairs.length}`, term, meaning: clamp(meaning, 120), source: { doc, section } });
  };
  for (const s of input.sections) {
    const rules = sectionRules(s.text);
    if (rules.length) push(termFor(rules[0], s.heading), rules[0], s.doc, s.heading);
  }
  // Fewer than four sections: pair the remaining rules of each section under "Spot the rule".
  if (pairs.length < 4) {
    for (const s of input.sections) {
      for (const rule of sectionRules(s.text).slice(1, 4)) {
        push(clamp(rule.split(/\s+/).slice(0, 3).join(" "), 40), rule, s.doc, s.heading);
      }
    }
  }
  return {
    title: clamp(`Speak ${input.packTitle}: words you'll hear`, 80),
    intro: "Match each term to its meaning before the clock runs out.",
    boardSize: 4,
    timeLimitSec: 60,
    lives: 5,
    pairs,
  };
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
      title: clamp(s.heading, 40),
      setting: (["office", "meeting-room", "reception", "video-call", "courtroom"] as const)[i % 5],
      lines: [
        { speaker: npc, text: clamp(`Quick one — "${s.heading}" says you should ${rule}`, 220), mood: "neutral" },
        { speaker: "player", text: "(They're asking about a rule from the course.)" },
      ],
      question: { speaker: npc, text: "Can you just skip it this once? I'm in a hurry.", mood: "sweating" },
      options: [
        {
          text: "No — the rule still applies when we're busy.",
          verdict: "best",
          response: [{ speaker: npc, text: "Ugh, fine — I'll do it properly.", mood: "sad" }],
          feedback: clamp(`"${s.heading}" applies even under pressure.`, 240),
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
          feedback: clamp(`That breaks "${s.heading}": ${rule}`, 240),
          source: { doc: s.doc, section: s.heading },
        },
      ],
    };
  });
  return {
    title: clamp(`${input.packTitle}: hold your ground`, 80),
    intro: "People will try to talk you into skipping the rules. Don't.",
    player: { name: clamp(input.playerName ?? "You", 18), character: "phoenix" },
    credibility: 4,
    cast,
    scenes,
  };
}
