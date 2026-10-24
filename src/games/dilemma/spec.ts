import { z } from "zod";
import { gameBaseSchema, sourceRefSchema, type GameSpecDefinition } from "../core/types";

export const MOODS = ["neutral", "happy", "thinking", "shocked", "angry", "sweating", "sad", "confident"] as const;
export const moodSchema = z.enum(MOODS).describe("Facial expression while the line is spoken");
export type Mood = z.infer<typeof moodSchema>;

export const SETTINGS = ["office", "meeting-room", "reception", "video-call", "courtroom"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "use a #rrggbb colour");

export const lookSchema = z
  .object({
    skin: hex.optional(),
    hair: hex.optional(),
    hairStyle: z.enum(["short", "spiky", "long", "bob", "bun", "bald"]).optional(),
    outfit: hex.optional().describe("Jacket colour"),
    accent: hex.optional().describe("Tie or top colour"),
    glasses: z.boolean().optional(),
  })
  .describe("How the character is drawn. Omit for a generated look");
export type Look = z.infer<typeof lookSchema>;

export const castMemberSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "lowercase id, e.g. 'caller'"),
  name: z.string().min(1).max(18).describe("Shown on the name tag"),
  role: z.string().max(40).optional().describe("e.g. 'IT Support (claims)'"),
  voice: z.enum(["low", "mid", "high"]).default("mid").describe("Pitch of the text blips"),
  look: lookSchema.optional(),
  portraitUrl: z.url().optional().describe("Optional image to show instead of the drawn character"),
});

export const lineSchema = z.object({
  speaker: z.string().min(1).describe("A cast id, 'player' for the new joiner, or 'narrator'"),
  text: z
    .string()
    .min(1)
    .max(220)
    .describe("What is said. Wrap key words in *asterisks* to show them in red. Player thoughts in (parentheses) show in blue"),
  mood: moodSchema.optional(),
});
export type Line = z.infer<typeof lineSchema>;

export const optionSchema = z.object({
  text: z.string().min(1).max(110).describe("What the player says"),
  verdict: z.enum(["best", "acceptable", "wrong"]).describe("best follows policy fully; acceptable is safe but incomplete; wrong breaks policy"),
  response: z.array(lineSchema).min(1).max(4).describe("How the scene reacts to this answer"),
  feedback: z.string().min(5).max(240).describe("The rule behind the verdict, shown as the player's thought afterwards"),
  source: sourceRefSchema.optional(),
});
export type DilemmaOption = z.infer<typeof optionSchema>;

export const sceneSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(40).describe("Scene banner, e.g. 'The Urgent Call'"),
    setting: z.enum(SETTINGS).default("office"),
    lines: z.array(lineSchema).min(1).max(8).describe("Build-up dialogue before the pressure moment"),
    question: lineSchema.describe("The pressure moment the player must answer"),
    options: z.array(optionSchema).min(2).max(4),
  })
  .refine((s) => s.options.some((o) => o.verdict === "best"), { message: "each scene needs at least one 'best' option", path: ["options"] })
  .refine((s) => new Set(s.options.map((o) => o.text)).size === s.options.length, { message: "options must be distinct", path: ["options"] });
export type Scene = z.output<typeof sceneSchema>;

export const dilemmaSpecSchema = gameBaseSchema
  .extend({
    player: z.object({ name: z.string().min(1).max(18).default("You"), look: lookSchema.optional() }).default({ name: "You" }),
    cast: z.array(castMemberSchema).min(1).max(6),
    scenes: z.array(sceneSchema).min(1).max(6),
    credibility: z.number().int().min(2).max(8).default(5).describe("Wrong answers allowed before the game is lost"),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set(spec.cast.map((c) => c.id));
    if (ids.size !== spec.cast.length) ctx.addIssue({ code: "custom", message: "cast ids must be unique", path: ["cast"] });
    const known = (speaker: string) => speaker === "player" || speaker === "narrator" || ids.has(speaker);
    spec.scenes.forEach((scene, s) => {
      const lines = [...scene.lines, scene.question, ...scene.options.flatMap((o) => o.response)];
      for (const line of lines) {
        if (!known(line.speaker)) ctx.addIssue({ code: "custom", message: `unknown speaker "${line.speaker}"`, path: ["scenes", s] });
      }
    });
  });

export type DilemmaSpec = z.output<typeof dilemmaSpecSchema>;
export type CastMember = z.output<typeof castMemberSchema>;

const infosec = (section: string) => ({ doc: "Information Security Policy v4.0", section });

export const dilemmaSample: DilemmaSpec = dilemmaSpecSchema.parse({
  title: "Turnabout Onboarding",
  intro: "Four people will try to talk you into breaking policy this week. Hold your ground.",
  player: { name: "You", look: { hair: "#1d1d2b", hairStyle: "spiky", outfit: "#2a4bd1", accent: "#e8e8f0" } },
  credibility: 4,
  cast: [
    { id: "caller", name: "Riley", role: "\"IT Support\"", voice: "mid", look: { hair: "#c76b2a", hairStyle: "short", outfit: "#3d3d46", accent: "#79c143", glasses: true } },
    { id: "prospect", name: "Dana Price", role: "Head of AI, prospect", voice: "high", look: { hair: "#2b1a12", hairStyle: "bob", outfit: "#7a1f3d", accent: "#f2d2a9" } },
    { id: "vendor", name: "Chris Vale", role: "Supplier, in a tender", voice: "low", look: { hair: "#e3c35b", hairStyle: "short", outfit: "#1f5e3a", accent: "#d63c3c" } },
    { id: "colleague", name: "Priya", role: "Teammate", voice: "high", look: { hair: "#101018", hairStyle: "long", outfit: "#5b3fc4", accent: "#ffd166" } },
  ],
  scenes: [
    {
      id: "urgent-call",
      title: "The Urgent Call",
      setting: "video-call",
      lines: [
        { speaker: "caller", text: "Hi! Riley from IT here. We're seeing *suspicious logins* on your account right now.", mood: "sweating" },
        { speaker: "player", text: "(An unexpected call, and it's urgent... that's a warning sign.)" },
      ],
      question: { speaker: "caller", text: "I just need the *six-digit code* from your authenticator to lock them out. Quick, before they get in!", mood: "angry" },
      options: [
        {
          text: "I can't share MFA codes. IT never asks for them. I'm reporting this in #security.",
          verdict: "best",
          response: [{ speaker: "caller", text: "Uh... the line's breaking up... I'll call back...", mood: "shocked" }],
          feedback: "Never share your account or MFA codes with anyone, including IT. IT will never ask. Report it in #security.",
          source: infosec("2. Accounts and passwords"),
        },
        {
          text: "Let me call you back on the IT Helpdesk number first.",
          verdict: "acceptable",
          response: [{ speaker: "caller", text: "There's *no time* for that!", mood: "angry" }],
          feedback: "Verifying on a number you already have is right, but an MFA code is never shared with anyone, and the attempt should be reported.",
          source: infosec("4. Phishing"),
        },
        {
          text: "Okay, it's 482 913.",
          verdict: "wrong",
          response: [{ speaker: "caller", text: "*Perfect.* That's all I needed. Bye now!", mood: "happy" }],
          feedback: "That's how accounts get taken over. If you share a code, report it in #security-incidents within 15 minutes and change your password.",
          source: infosec("4. Phishing"),
        },
      ],
    },
    {
      id: "big-promise",
      title: "The Big Promise",
      setting: "meeting-room",
      lines: [
        { speaker: "prospect", text: "Your competitor promised us *40% lower costs* by next quarter.", mood: "confident" },
        { speaker: "prospect", text: "We're ready to sign with whoever gives us the best number.", mood: "neutral" },
      ],
      question: { speaker: "prospect", text: "So. What improvement can Mubit *guarantee* us?", mood: "thinking" },
      options: [
        {
          text: "We never promise a fixed number. Let's measure task success, latency and cost on your own held-out tasks.",
          verdict: "best",
          response: [{ speaker: "prospect", text: "...Fair. *Evidence over opinion.* I respect that.", mood: "happy" }],
          feedback: "Never promise a specific improvement: results depend on the workload. Offer to measure on the customer's own held-out tasks.",
          source: { doc: "Go-to-Market Onboarding Guide v1.8", section: "4. What we never say" },
        },
        {
          text: "It varies, but customers usually see big savings.",
          verdict: "acceptable",
          response: [{ speaker: "prospect", text: "\"Usually big\"? I'll need more than that.", mood: "thinking" }],
          feedback: "\"Usually big savings\" is still an implied promise. Offer to measure on their held-out tasks instead.",
          source: { doc: "Go-to-Market Onboarding Guide v1.8", section: "4. What we never say" },
        },
        {
          text: "We can do 50%, easily.",
          verdict: "wrong",
          response: [{ speaker: "prospect", text: "Wonderful. I'll put *50%* in the contract, then.", mood: "confident" }],
          feedback: "Never promise a specific improvement such as \"30% cheaper\" or \"2x accuracy\". Results depend on the workload.",
          source: { doc: "Go-to-Market Onboarding Guide v1.8", section: "4. What we never say" },
        },
      ],
    },
    {
      id: "generous-offer",
      title: "A Generous Offer",
      setting: "reception",
      lines: [
        { speaker: "vendor", text: "Thanks for meeting us during the tender! Good luck choosing.", mood: "happy" },
        { speaker: "vendor", text: "By the way, I've got *two cup final tickets*. £120 each. Bring a friend!", mood: "confident" },
      ],
      question: { speaker: "vendor", text: "Shall I put you down for Saturday?", mood: "happy" },
      options: [
        {
          text: "That's kind, but I can't accept anything during an active tender. I'll let my manager know you offered.",
          verdict: "best",
          response: [{ speaker: "vendor", text: "Ah. Of course. Rules are rules!", mood: "sweating" }],
          feedback: "Anything offered during an active deal or tender: decline politely and tell your manager, whatever its value.",
          source: { doc: "Anti-Bribery, Gifts and Conflicts of Interest Policy v1.6", section: "2. Accepting gifts and hospitality" },
        },
        {
          text: "I'll declare them in the gifts register first.",
          verdict: "acceptable",
          response: [{ speaker: "vendor", text: "Great, so that's a yes?", mood: "happy" }],
          feedback: "£50-£150 normally means declaring in the gifts register, but during an active tender you must decline.",
          source: { doc: "Anti-Bribery, Gifts and Conflicts of Interest Policy v1.6", section: "2. Accepting gifts and hospitality" },
        },
        {
          text: "Brilliant, see you Saturday!",
          verdict: "wrong",
          response: [{ speaker: "vendor", text: "Wonderful! I'm sure we'll *win this tender* together.", mood: "confident" }],
          feedback: "Accepting anything during a tender can look like it influences the decision. Decline and tell your manager.",
          source: { doc: "Anti-Bribery, Gifts and Conflicts of Interest Policy v1.6", section: "1. Our rule" },
        },
      ],
    },
    {
      id: "quick-summary",
      title: "Just a Quick Summary",
      setting: "office",
      lines: [
        { speaker: "colleague", text: "This customer trace is *enormous*. I'm pasting it into a chatbot to summarise it.", mood: "neutral" },
        { speaker: "player", text: "(A customer trace... which class of data is that again?)" },
      ],
      question: { speaker: "colleague", text: "You don't mind, right? It'll save us an hour!", mood: "happy" },
      options: [
        {
          text: "Stop! Customer traces are Restricted data. They never go into any AI tool, approved or not.",
          verdict: "best",
          response: [{ speaker: "colleague", text: "Oh no, you're right. Deleting the tab now!", mood: "shocked" }],
          feedback: "Never paste Restricted data such as customer traces, prompts or credentials into any AI tool, approved or not.",
          source: { doc: "Employee Handbook v3.2", section: "10. Using AI tools at work" },
        },
        {
          text: "Use one of the approved AI tools from Notion instead.",
          verdict: "acceptable",
          response: [{ speaker: "colleague", text: "Okay, switching to the approved one...", mood: "thinking" }],
          feedback: "Approved tools are fine for most work, but Restricted data never goes into any AI tool, approved or not.",
          source: { doc: "Employee Handbook v3.2", section: "10. Using AI tools at work" },
        },
        {
          text: "Sure, just delete the chat afterwards.",
          verdict: "wrong",
          response: [{ speaker: "colleague", text: "Done! Wait... is it stored somewhere now?", mood: "sweating" }],
          feedback: "Customer traces are Restricted: approved systems only, never pasted into AI tools. Deleting afterwards doesn't undo it.",
          source: infosec("1. Data classification"),
        },
      ],
    },
  ],
});

export const dilemmaGame: GameSpecDefinition<DilemmaSpec> = {
  id: "dilemma",
  name: "Dilemma",
  description: "An Ace Attorney-style confrontation: someone pressures you in conversation, and you pick what to say.",
  bestFor:
    "Judgement in conversations: social engineering, customer promises, gifts and conflicts, data requests, escalations. Situations where the right answer is what you say under pressure.",
  authoringTips: [
    "Write 3-5 scenes, each a realistic person pressuring the new joiner. 1-4 build-up lines, then one pressure question.",
    "Give each scene one 'best' answer (follows policy fully), one 'acceptable' (safe but incomplete) and one 'wrong' (breaks policy).",
    "Make the wrong answer tempting: it should sound helpful or polite.",
    "Put the rule in `feedback` and cite it in `source`. Wrap key words in *asterisks*; write the player's thoughts in (parentheses).",
    "Pick a setting per scene: office, meeting-room, reception, video-call or courtroom.",
  ],
  schema: dilemmaSpecSchema,
  sample: dilemmaSample,
};
