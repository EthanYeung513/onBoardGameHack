import type { BattleArena } from "@/games/battle/spec";
import type { GenerateGameInput } from "./generate-game";

/** An opponent for one kind of course: a classic Pokémon (dex 1-251, no legendaries) named after the course's risk. */
interface Foe {
  pokemon: number;
  name: string;
}

interface BattleTheme {
  arena: BattleArena;
  /** Course words that point at this theme; matched as word prefixes ("phish" matches "phishing"). */
  keywords: string[];
  foes: Foe[];
  moves: string[];
}

/** Ordered so that, on a tied score, the more specific themes win over the general company one. */
const THEMES: BattleTheme[] = [
  {
    arena: "haunted",
    keywords: ["security", "phish", "password", "scam", "fraud", "badge", "tailgat", "mfa", "multi-factor", "suspicious", "attack", "malware"],
    foes: [
      { pokemon: 94, name: "PHISHMONGER" },
      { pokemon: 93, name: "SPOOFER" },
      { pokemon: 200, name: "PRETEXTER" },
      { pokemon: 215, name: "TAILGATER" },
      { pokemon: 198, name: "CREDENTIAL CROW" },
    ],
    moves: ["Spoofed Link", "Urgent Ask", "Fake Login", "Tailgate"],
  },
  {
    arena: "snow",
    keywords: ["privacy", "data protection", "gdpr", "personal data", "confidential", "retention", "ai tool"],
    foes: [
      { pokemon: 124, name: "OVERSHARER" },
      { pokemon: 225, name: "DATA LEAK" },
      { pokemon: 87, name: "SHADOW AI" },
      { pokemon: 220, name: "COLD STORAGE" },
    ],
    moves: ["Overshare", "Paste to Chat", "Wrong Recipient", "Keep Forever"],
  },
  {
    arena: "city",
    keywords: ["payment", "payout", "ledger", "card", "settlement", "transaction", "invoice", "chargeback", "money", "bank"],
    foes: [
      { pokemon: 52, name: "PAYDAY GLITCH" },
      { pokemon: 53, name: "DOUBLE PAYOUT" },
      { pokemon: 81, name: "LEDGER DRIFT" },
      { pokemon: 100, name: "CHARGEBACK" },
      { pokemon: 137, name: "ROUNDING BUG" },
    ],
    moves: ["Double Spend", "Stale Retry", "Rounding Error", "Silent Fail"],
  },
  {
    arena: "volcano",
    keywords: ["engineering", "deploy", "incident", "outage", "on-call", "postmortem", "rollback", "production", "release", "code"],
    foes: [
      { pokemon: 126, name: "OUTAGE" },
      { pokemon: 218, name: "HOTFIX" },
      { pokemon: 77, name: "PAGER STORM" },
      { pokemon: 58, name: "BAD DEPLOY" },
    ],
    moves: ["Friday Deploy", "Skip Review", "Page Storm", "Hot Patch"],
  },
  {
    arena: "beach",
    keywords: ["customer", "support", "complaint", "refund", "merchant", "tone", "ticket", "vulnerable", "caller"],
    foes: [
      { pokemon: 54, name: "CONFUSION" },
      { pokemon: 79, name: "SLOW REPLY" },
      { pokemon: 118, name: "ANGRY CALLER" },
      { pokemon: 183, name: "HOLD MUSIC" },
    ],
    moves: ["Hold Music", "Copy Paste", "Overpromise", "Blame Game"],
  },
  {
    arena: "desert",
    keywords: ["warehouse", "forklift", "safety", "logistics", "shipping", "stock", "pallet", "shift", "loading"],
    foes: [
      { pokemon: 74, name: "PALLET JAM" },
      { pokemon: 95, name: "FORKLIFT" },
      { pokemon: 111, name: "SHORTCUT" },
      { pokemon: 207, name: "NEAR MISS" },
    ],
    moves: ["Skip Check", "Heavy Lift", "Blocked Exit", "Rush Job"],
  },
  {
    arena: "cave",
    keywords: ["compliance", "audit", "regulat", "legal", "gift", "bribery", "conflict of interest", "anti-money", "sanction"],
    foes: [
      { pokemon: 41, name: "GREY AREA" },
      { pokemon: 42, name: "LOOPHOLE" },
      { pokemon: 92, name: "RED FLAG" },
      { pokemon: 202, name: "BOX TICKER" },
    ],
    moves: ["Loophole", "Off the Books", "Small Favour", "No Paper Trail"],
  },
  {
    arena: "meadow",
    keywords: ["company", "handbook", "welcome", "holiday", "expense", "values", "culture", "team", "basics", "people"],
    foes: [
      { pokemon: 96, name: "SLACKER" },
      { pokemon: 143, name: "PROCRASTINATOR" },
      { pokemon: 19, name: "CORNER CUTTER" },
      { pokemon: 161, name: "BUSYBODY" },
      { pokemon: 39, name: "SMALL PRINT" },
    ],
    moves: ["Corner Cut", "Vague Ask", "Policy Fog", "Not My Job"],
  },
];

/** FNV-1a: a stable, well-spread hash so the same course always meets the same opponent. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function hits(text: string, keyword: string): number {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.match(new RegExp(`\\b${escaped}`, "g"))?.length ?? 0;
}

/**
 * The opponent, its moves and the arena for a course, chosen from what the course is about: the course title
 * counts most, then section headings, then the text. Within a theme the course picks one of several foes, so two
 * courses on the same topic still look different. A course matching no theme gets one picked by hash.
 */
export function battleThemeFor(input: GenerateGameInput): { arena: BattleArena; opponent: Foe & { moves: string[] } } {
  const title = input.packTitle.toLowerCase();
  const headings = input.sections.map((s) => s.heading).join(" \n ").toLowerCase();
  const text = input.sections.map((s) => s.text).join(" \n ").toLowerCase();
  const scored = THEMES.map((theme) => ({
    theme,
    score: theme.keywords.reduce((sum, k) => sum + 6 * hits(title, k) + 2 * hits(headings, k) + Math.min(hits(text, k), 5), 0),
  }));
  const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
  const seed = hash(`${input.packTitle}\n${input.sections.map((s) => s.heading).join("\n")}`);
  const theme = best.score > 0 ? best.theme : THEMES[seed % THEMES.length];
  const foe = theme.foes[seed % theme.foes.length];
  // Rotate the move list too, so the first attack differs between courses sharing a theme.
  const offset = seed % theme.moves.length;
  const moves = [...theme.moves.slice(offset), ...theme.moves.slice(0, offset)].slice(0, 3);
  return { arena: theme.arena, opponent: { ...foe, moves } };
}
