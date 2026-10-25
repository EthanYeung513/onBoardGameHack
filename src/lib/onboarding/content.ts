// Turns a space's real content into the `OB.*` overrides the mockup's hire-facing world reads
// (templates/onboarding: state.js + game.js). Pure and defensive: CourseSpec steps are read by
// kind; nothing is invented — a mini-game with no real content falls back to another game that
// has content, and the world is labelled when it was generated offline.

export interface OnboardingInput {
  space: { name: string; host: string; slug: string; mode?: "live" | "offline" };
  brand: { primary?: string; accent?: string; surface?: string; voice?: string } | null;
  courses: { packType: string; title: string; icon: string; building: string; game: string; spec: unknown }[];
  /** Approved facts (what the world teaches). */
  facts: { text: string; category: string; entityName?: string; entityType?: string }[];
  /** Facts the manager rejected — real "don't keep this" inbox cards. */
  rejected: { text: string; category: string }[];
  rewards: { name: string; costCoins: number }[];
}

type QuizItem = { q: string; a: string[]; correct: number };
type ScenarioLine = { from: string; role: string; line: string; options: { text: string; score: number; reply: string }[] };

/** The mockup world's fixed building slots, in pack order. */
const SLOTS: { id: string; pack: string[] }[] = [
  { id: "c1", pack: ["company", "company-101"] },
  { id: "c2", pack: ["people-culture", "people"] },
  { id: "c3", pack: ["tools-stack", "tools"] },
  { id: "c4", pack: ["hard-conversations", "scenarios"] },
];
const ICONS = new Set(["landmark", "users", "wrench", "target", "book", "code", "hash", "kanban", "file", "globe", "star", "building", "chart", "layers", "sparkle", "trophy"]);
const NPC_SPOTS = [
  { x: 14, y: 8, color: "#e11d48" },
  { x: 26, y: 10, color: "#0891b2" },
  { x: 10, y: 18, color: "#ca8a04" },
  { x: 22, y: 20, color: "#7c3aed" },
  { x: 17, y: 14, color: "#0e9f6e" },
];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const steps = (spec: unknown): Record<string, unknown>[] => {
  const s = (spec as { steps?: unknown })?.steps;
  return Array.isArray(s) ? (s.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
};

/** Options as `string[]` + the correct index, from the shapes a CourseSpec quiz step may use. */
function quizOf(step: Record<string, unknown>): QuizItem | null {
  const raw = Array.isArray(step.options) ? step.options : [];
  const texts: string[] = [];
  let correct = typeof step.correct === "number" ? step.correct : typeof step.answer === "number" ? step.answer : -1;
  raw.forEach((o, i) => {
    if (typeof o === "string") texts.push(o);
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      texts.push(str(r.text) || str(r.label) || str(r.title));
      if (r.correct === true || r.isCorrect === true) correct = i;
    }
  });
  if (correct < 0 && typeof step.answer === "string") correct = texts.indexOf(step.answer);
  const q = str(step.question) || str(step.title) || str(step.body);
  if (!q || texts.length < 2 || texts.some((t) => !t) || correct < 0 || correct >= texts.length) return null;
  return { q, a: texts, correct };
}

function scenarioOf(step: Record<string, unknown>, company: string): ScenarioLine | null {
  const raw = Array.isArray(step.options) ? step.options : [];
  const options = raw
    .map((o) => {
      if (!o || typeof o !== "object") return null;
      const r = o as Record<string, unknown>;
      const text = str(r.text) || str(r.label);
      if (!text) return null;
      const score = typeof r.score === "number" ? r.score : r.correct === true || r.best === true ? 2 : 0;
      return { text, score, reply: str(r.reply) || str(r.feedback) || str(r.why) || "" };
    })
    .filter((o): o is { text: string; score: number; reply: string } => o !== null);
  const line = str(step.body) || str(step.title);
  if (!line || options.length < 2) return null;
  return { from: str(step.character) || str(step.from) || "A teammate", role: str(step.role) || company, line, options };
}

export function buildOnboardingContent(input: OnboardingInput) {
  const company = input.space.name;
  const quiz: QuizItem[] = [];
  const scenario: ScenarioLine[] = [];
  const used = new Set<string>();

  const courses = SLOTS.flatMap((slot) => {
    const c = input.courses.find((x) => slot.pack.includes(x.packType) && !used.has(x.packType));
    if (!c) return [];
    used.add(c.packType);
    const ss = steps(c.spec);
    for (const st of ss) {
      if (st.kind === "quiz") {
        const q = quizOf(st);
        if (q) quiz.push(q);
      }
      if (st.kind === "scenario") {
        const s = scenarioOf(st, company);
        if (s) scenario.push(s);
      }
    }
    const lessons = ss.filter((st) => st.kind === "lesson").map((st) => str(st.title)).filter(Boolean);
    const firstBody = ss.map((st) => str(st.body)).find(Boolean) ?? "";
    return [{ id: slot.id, title: c.title, building: c.building, icon: ICONS.has(c.icon) ? c.icon : "book", game: c.game, desc: firstBody.slice(0, 140), lessons }];
  });

  const inbox = [
    ...input.facts.map((f) => ({ text: f.text, save: true, why: `${f.category}: this is how things work at ${company}.` })),
    ...input.rejected.map((f) => ({ text: f.text, save: false, why: `Not true at ${company} — your manager ruled it out.` })),
  ].slice(0, 12);
  const road = quiz.map((q) => {
    const wrong = q.a.findIndex((_, i) => i !== q.correct);
    const pair = [q.a[q.correct], q.a[wrong]];
    const flip = q.q.length % 2 === 1;
    return { q: q.q, a: flip ? [pair[1], pair[0]] : pair, correct: flip ? 1 : 0 };
  });
  const pools: Record<string, number> = { quiz: quiz.length, inbox: inbox.length, road: road.length, scenario: scenario.length };
  // A building whose game has no real content plays a game that does (never invented content).
  const fallback = (["quiz", "inbox", "road", "scenario"] as const).find((g) => pools[g] > 0);
  for (const c of courses) if (!pools[c.game] && fallback) c.game = fallback;

  const npcs = input.facts
    .filter((f) => f.entityType === "person" && f.entityName)
    .filter((f, i, all) => all.findIndex((g) => g.entityName === f.entityName) === i)
    .slice(0, NPC_SPOTS.length)
    .map((f, i) => ({ name: f.entityName!, role: f.category, fact: f.text, ...NPC_SPOTS[i] }));

  const rewards = input.rewards.slice(0, 6).map((r, i) => ({ id: `r${i + 1}`, name: r.name, cost: r.costCoins, icon: "gift", emoji: "🎁" }));

  return {
    company,
    host: input.space.host,
    offline: input.space.mode === "offline",
    brand: {
      company,
      host: input.space.host,
      primary: input.brand?.primary ?? "#2f6bff",
      accent: input.brand?.accent ?? "#ff5c39",
      initials: company.slice(0, 2).toUpperCase(),
    },
    COURSES: courses,
    QUIZ: quiz,
    INBOX_CARDS: inbox,
    ROAD_QUESTIONS: road,
    SCENARIO: scenario,
    NPCS: npcs,
    BRAIN_FACTS: input.facts.map((f) => ({ cat: f.category, text: f.text })),
    REWARDS: rewards,
    playable: courses.length > 0 && Boolean(fallback),
  };
}

export type OnboardingContent = ReturnType<typeof buildOnboardingContent>;

/** The generated `onboarding.js`: applies the content to the mockup world before game.js runs. */
export function onboardingScript(content: OnboardingContent, meta: { generatedAt: string; mode: "vercel" | "stand-in" }): string {
  const data = JSON.stringify(content).replace(/</g, "\\u003c");
  return `/* Generated by Orthogonal for ${content.company} at ${meta.generatedAt} (${meta.mode}). Do not edit. */
(function () {
  var D = ${data};
  ["COURSES", "QUIZ", "INBOX_CARDS", "ROAD_QUESTIONS", "SCENARIO", "NPCS", "BRAIN_FACTS", "REWARDS"].forEach(function (k) {
    OB[k].length = 0; Array.prototype.push.apply(OB[k], D[k]);
  });
  OB.patch({ brand: D.brand });
  document.title = D.company + " onboarding";
  // Buildings whose course isn't generated yet stay closed instead of crashing the world.
  document.addEventListener("DOMContentLoaded", function () {
    var launch = window.launchCourse;
    window.launchCourse = function (id) {
      if (OB.COURSES.some(function (c) { return c.id === id; })) return launch(id);
      openMG("Opening soon", "This building opens when your manager generates its course.", "");
    };
  });
  if (D.offline || ${JSON.stringify(meta.mode === "stand-in")}) {
    var b = document.createElement("div");
    b.textContent = ${JSON.stringify(meta.mode === "stand-in" ? "Preview build (stand-in) — served by Orthogonal, not yet deployed to its own Vercel project" : "")} + (D.offline ? " · content generated offline (stand-in)" : "");
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99;padding:6px 10px;font:12px system-ui;background:#fff3cd;color:#664d03;text-align:center";
    document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(b); });
  }
})();
`;
}
