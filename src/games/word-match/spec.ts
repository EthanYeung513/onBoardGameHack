import { z } from "zod";
import { gameBaseSchema, sourceRefSchema, type GameSpecDefinition } from "../core/types";

export const wordPairSchema = z.object({
  id: z.string().min(1).describe("Stable id, e.g. 'lora'"),
  term: z.string().min(1).max(40).describe("The word or name to learn, max 40 characters"),
  meaning: z.string().min(3).max(120).describe("What it means in this company's words, max 120 characters"),
  source: sourceRefSchema.optional(),
});

export const wordMatchSpecSchema = gameBaseSchema
  .extend({
    pairs: z.array(wordPairSchema).min(4).max(24).describe("Term/meaning pairs. Split into boards of `boardSize`"),
    boardSize: z.number().int().min(3).max(6).default(4).describe("Pairs shown at once"),
    timeLimitSec: z.number().int().min(15).max(300).default(60).describe("Seconds per board"),
    lives: z.number().int().min(1).max(9).default(5).describe("Wrong matches allowed in the whole game"),
  })
  .refine((s) => new Set(s.pairs.map((p) => p.term.toLowerCase())).size === s.pairs.length, { message: "terms must be distinct", path: ["pairs"] })
  .refine((s) => new Set(s.pairs.map((p) => p.meaning.toLowerCase())).size === s.pairs.length, { message: "meanings must be distinct", path: ["pairs"] })
  .refine((s) => new Set(s.pairs.map((p) => p.id)).size === s.pairs.length, { message: "pair ids must be unique", path: ["pairs"] });

export type WordMatchSpec = z.output<typeof wordMatchSpecSchema>;
export type WordPair = z.output<typeof wordPairSchema>;

const primer = (section: string) => ({ doc: "LLM Infrastructure Primer v1.2", section });
const overview = (section: string) => ({ doc: "Welcome to Mubit: Company and Product Overview v2.0", section });

export const wordMatchSample: WordMatchSpec = wordMatchSpecSchema.parse({
  title: "Speak Mubit: words you'll hear in week one",
  intro: "Match each term to its meaning. Chain correct matches for a combo.",
  boardSize: 4,
  timeLimitSec: 60,
  lives: 5,
  pairs: [
    { id: "base-url", term: "Base URL", meaning: "Change it (and the API key) to route an app's model calls through a gateway like Mubit", source: primer("1. OpenAI-compatible APIs and base URLs") },
    { id: "ttft", term: "TTFT", meaning: "Time to first token: decides how fast a product feels", source: primer("3. Latency") },
    { id: "p95", term: "p95 latency", meaning: "The slowest 5% of requests, the ones customers notice", source: primer("3. Latency") },
    { id: "lora", term: "LoRA adapter", meaning: "Small trained matrices on a frozen base model, megabytes in size and swappable per request", source: primer("4. Fine-tuning and adapters (LoRA)") },
    { id: "held-out", term: "Held-out set", meaning: "Examples kept out of training and used only to measure quality", source: primer("5. Evaluation") },
    { id: "cost-success", term: "Cost per successful task", meaning: "Total cost divided by the tasks that actually succeeded", source: primer("5. Evaluation") },
    { id: "rag", term: "RAG", meaning: "Retrieves relevant chunks into the prompt so the model answers from your data", source: primer("7. Retrieval-augmented generation (RAG)") },
    { id: "mcp", term: "MCP", meaning: "Open protocol connecting AI apps to tools and data through hosts, clients and servers", source: primer("8. Model Context Protocol (MCP)") },
    { id: "sapling", term: "Banyan Sapling", meaning: "Checks a claim against policy: supported, violation, missing information or inconsistent context", source: overview("Banyan models and latte/bench") },
    { id: "forge", term: "Forge", meaning: "Trains task-specific adapters on open-weight base models", source: { doc: "Engineering Onboarding Guide v5.4", section: "1. Architecture at a glance" } },
    { id: "latte", term: "latte/bench", meaning: "Benchmark testing whether a model learns from feedback, using simulated latte art", source: overview("Banyan models and latte/bench") },
    { id: "calibration", term: "Runtime calibration", meaning: "Improving how an agent behaves using evidence from its own runs", source: overview("What Mubit does") },
  ],
});

export const wordMatchGame: GameSpecDefinition<WordMatchSpec> = {
  id: "word-match",
  name: "Word Match",
  description: "An arcade matching game: pair each term with its meaning against the clock, chaining combos.",
  bestFor:
    "Vocabulary and names: product terms, acronyms, internal tools, teams and what they own, systems and what they do. Content where knowing what a word means is the goal.",
  authoringTips: [
    "Write 8-16 pairs. Terms are short; meanings are one plain sentence in the company's own words.",
    "Make meanings distinct enough that each matches exactly one term.",
    "Group related pairs next to each other in the list: each board takes the next `boardSize` pairs, so boards stay on one topic.",
    "Cite the document section in `source` so the results screen can point back to it.",
  ],
  schema: wordMatchSpecSchema,
  sample: wordMatchSample,
};
