import { z } from "zod";
import { gameBaseSchema, sourceRefSchema, type GameSpecDefinition } from "../core/types";

const pokemonSchema = z
  .number()
  .int()
  .min(1)
  .max(649)
  .describe("National Pokédex number (1-649, Gen 1-5 have animated sprites), e.g. 94 Gengar, 25 Pikachu, 6 Charizard");

export const battleRoundSchema = z
  .object({
    id: z.string().min(1).describe("Stable id, e.g. 'phish-1'"),
    prompt: z.string().min(5).max(180).describe("The question, shown in the battle text box"),
    choices: z.array(z.string().min(1).max(48)).min(2).max(4).describe("2-4 answers, shown as moves. Under 48 characters each"),
    answer: z.number().int().min(0).describe("Index in `choices` of the one correct answer"),
    explanation: z.string().min(5).max(220).describe("Why the answer is right, shown after every attempt"),
    source: sourceRefSchema.optional(),
  })
  .refine((r) => r.answer < r.choices.length, { message: "answer must be an index into choices", path: ["answer"] })
  .refine((r) => new Set(r.choices).size === r.choices.length, { message: "choices must be distinct", path: ["choices"] });

/** Battle backdrops: each maps to a field palette in battle.module.css. */
export const BATTLE_ARENAS = ["meadow", "beach", "cave", "city", "haunted", "snow", "desert", "volcano"] as const;
export type BattleArena = (typeof BATTLE_ARENAS)[number];

const fighterSchema = z.object({
  name: z.string().min(1).max(16).describe("Shown in the HP box, max 16 characters"),
  pokemon: pokemonSchema,
  level: z.number().int().min(1).max(100).default(30),
});

export const battleSpecSchema = gameBaseSchema.extend({
  opponent: fighterSchema.extend({
    moves: z
      .array(z.string().min(1).max(20))
      .min(1)
      .max(4)
      .default(["Tackle"])
      .describe("Attack names the opponent uses when the player answers wrong, themed on the topic"),
  }),
  player: fighterSchema.default({ name: "New Joiner", pokemon: 25, level: 30 }),
  arena: z
    .enum(BATTLE_ARENAS)
    .default("meadow")
    .describe(
      "Where the battle takes place, themed on the course: meadow (green field), beach, cave, city (at night), haunted (purple dusk), snow, desert or volcano",
    ),
  rounds: z.array(battleRoundSchema).min(3).max(12).describe("Questions with exactly one correct answer"),
  lives: z.number().int().min(1).max(5).default(3).describe("How many wrong answers the player survives"),
});

export type BattleSpec = z.output<typeof battleSpecSchema>;
export type BattleRound = z.output<typeof battleRoundSchema>;

const infosec = (section: string) => ({ doc: "Information Security Policy v4.0", section });

export const battleSample: BattleSpec = battleSpecSchema.parse({
  title: "Security basics: battle the Phishmonger",
  intro: "Every new joiner completes security training in their first 14 days. Answer right to land a hit.",
  opponent: { name: "PHISHMONGER", pokemon: 94, level: 32, moves: ["Spoofed Link", "Urgent Ask", "Gift Card Scam"] },
  player: { name: "NEW JOINER", pokemon: 25, level: 30 },
  arena: "haunted",
  lives: 3,
  rounds: [
    {
      id: "phish-urgent",
      prompt: '"The CEO needs this in 10 minutes", with a link to a log-in page. What do you do first?',
      choices: ["Click it, it's urgent", "Report phish, don't click", "Reply to check it's real", "Forward it to your team"],
      answer: 1,
      explanation: "Urgency outside the usual process is the top warning sign. Don't click or reply: use Report phish and post in #security.",
      source: infosec("4. Phishing"),
    },
    {
      id: "phish-clicked",
      prompt: "You already clicked a phishing link and typed your password. Report it within...",
      choices: ["15 minutes", "1 hour", "End of the day", "24 hours"],
      answer: 0,
      explanation: "Report in #security-incidents within 15 minutes and change your password. Nobody is blamed for reporting.",
      source: infosec("4. Phishing"),
    },
    {
      id: "mfa-it",
      prompt: "\"Hi, it's IT. Read me your MFA code so I can fix your account.\"",
      choices: ["Read it out, it's IT", "Refuse: IT never asks", "Give only half the code", "Email it to them"],
      answer: 1,
      explanation: "Never share your account or MFA codes with anyone, including IT. IT will never ask for them.",
      source: infosec("2. Accounts and passwords"),
    },
    {
      id: "mfa-method",
      prompt: "Which way of getting MFA codes is NOT allowed at Mubit?",
      choices: ["Hardware key", "Authenticator app", "SMS codes"],
      answer: 2,
      explanation: "Use a hardware key or an authenticator app. SMS codes are not allowed.",
      source: infosec("2. Accounts and passwords"),
    },
    {
      id: "bank-change",
      prompt: "A supplier emails asking to change their bank details today. How do you verify it?",
      choices: ["Call the number in the email", "Call a number you already have", "Reply to the email", "Approve it if under £500"],
      answer: 1,
      explanation: "Verify by calling the person on a number you already have. Never use a phone number from the message itself.",
      source: infosec("4. Payment and bank detail changes"),
    },
    {
      id: "tailgate",
      prompt: "Someone you don't recognise tries to follow you through the office door.",
      choices: ["Hold the door, be nice", "Ask who they're visiting", "Ignore them", "Lock yourself in"],
      answer: 1,
      explanation: "Holding the door is tailgating. Politely ask who they are visiting and send them to reception.",
      source: infosec("5. Physical security"),
    },
  ],
});

export const battleGame: GameSpecDefinition<BattleSpec> = {
  id: "battle",
  name: "Battle",
  description: "A Pokémon-style battle: each right answer lands a hit, each wrong one gets you hit. Missed questions come back.",
  bestFor:
    "Facts and rules with exactly one correct answer: limits, deadlines, who to contact, what to do first. Good for policies like security, expenses and incident response.",
  authoringTips: [
    "Write 5-8 rounds. Each needs one unambiguous correct answer from the source document.",
    "Make wrong choices plausible mistakes a new joiner would make, not jokes.",
    "Keep choices under 48 characters: they are shown as move buttons.",
    "Put the reason and the rule in `explanation`, and cite the section in `source`.",
    "Pick a different opponent for every course: a classic Pokémon (dex 1-251, no legendaries) that fits the topic, e.g. a ghost like 94 Gengar for phishing, 52 Meowth for payments, 126 Magmar for incidents, 54 Psyduck for customer support.",
    "Name the opponent (max 16 characters) after the risk the course guards against, in the course's own words (e.g. PHISHMONGER, DOUBLE PAYOUT), and name its moves after the mistakes it tempts.",
    "Set `arena` to match the course's world (e.g. haunted for security, city for payments, volcano for incidents, beach for support); meadow is the plain default.",
  ],
  schema: battleSpecSchema,
  sample: battleSample,
};
