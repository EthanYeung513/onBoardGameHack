import type { CourseGame } from "./course-spec";

// The four default courses, exactly as the mockup's state.js `COURSES` (title, building, icon,
// game, description, lesson outline); pack ids are PRD "Subsystem: courses and editor". Each pack
// is built from the brain categories that feed it.
// `packType` is the upsert key with the space (courses.by_space_pack).

export type FactCategory = "Glossary" | "People" | "Tools" | "Rituals" | "Docs & History" | "Policy" | "Product" | "Other";

export interface CoursePack {
  /** A default pack id, or `topic-<slug>` for a course the manager asked for by name (F22). */
  packType: string;
  title: string;
  building: string;
  icon: string;
  game: CourseGame;
  desc: string;
  /** The mockup's course plan — an outline hint for the model, not content. */
  lessons: string[];
  /** Brain categories this course teaches, most important first. */
  categories: FactCategory[];
  /** Set on manager-named courses: what the facts are retrieved by (relevance, not category). */
  topic?: string;
}

export const COURSE_PACKS: CoursePack[] = [
  {
    packType: "company",
    title: "Company 101",
    building: "HQ Hall",
    icon: "landmark",
    game: "quiz",
    desc: "History, mission, and how we talk to each other.",
    lessons: ["Origin story & pivot", "Mission & values", "Glossary & acronyms"],
    categories: ["Docs & History", "Product", "Glossary", "Other"],
  },
  {
    packType: "people-culture",
    title: "People & Culture",
    building: "Community Hall",
    icon: "users",
    game: "inbox",
    desc: "Who's who, rituals, birthdays and unwritten rules.",
    lessons: ["Org map", "Rituals & rhythms", "Unwritten rules"],
    categories: ["People", "Rituals"],
  },
  {
    packType: "tools-stack",
    title: "Tools & Stack",
    building: "Workshop",
    icon: "wrench",
    game: "road",
    desc: "The stack you'll live in: repos, boards, deploys.",
    lessons: ["Repos & CI", "Boards & tickets", "Ship to prod"],
    categories: ["Tools"],
  },
  {
    packType: "hard-conversations",
    title: "Hard Conversations",
    building: "Dojo",
    icon: "target",
    game: "scenario",
    desc: "Practice real scenarios with AI characters.",
    lessons: ["Giving feedback", "Handling conflict", "Escalating well"],
    categories: ["Policy", "Rituals", "People"],
  },
];

export const PACK_TYPES = COURSE_PACKS.map((p) => p.packType);

/** A course needs at least this many approved facts in its categories; fewer → skipped and logged. */
export const MIN_FACTS_PER_COURSE = 2;
/** A manager-named topic needs this many relevant facts; fewer → an honest "not enough" message. */
export const MIN_FACTS_PER_TOPIC = 3;
/** At most this many facts go into one course prompt (most relevant first): keeps generation fast. */
export const MAX_FACTS_PER_COURSE = 14;

export const TOPIC_PREFIX = "topic-";
const ALL_CATEGORIES: FactCategory[] = ["Policy", "Tools", "People", "Rituals", "Product", "Glossary", "Docs & History", "Other"];
// The mockup's generated-course buildings (dashboard.html GEN_BUILDINGS), and a building/icon/game
// that suits common topics; anything else gets a stable pick from the mockup's list and its "book".
const GEN_BUILDINGS = ["Hall", "Library", "Arcade", "Conservatory", "Foundry", "Gallery"];
const TOPIC_STYLES: { re: RegExp; building: string; icon: string; game: CourseGame }[] = [
  { re: /secur|privacy|complian|gdpr|soc ?2|risk|safety|incident|access|password|legal|conduct|ethic/, building: "Watchtower", icon: "target", game: "scenario" },
  { re: /customer|support|sales|deal|pricing|billing|client/, building: "Market", icon: "coin", game: "inbox" },
  { re: /engineer|code|deploy|stack|tool|api|infra|data|dev/, building: "Foundry", icon: "code", game: "road" },
  { re: /team|people|culture|hiring|manager|feedback|meeting|ritual/, building: "Community Hall", icon: "users", game: "inbox" },
  { re: /product|feature|roadmap|design|launch/, building: "Gallery", icon: "layers", game: "quiz" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** "Security best practices" → "Security best practices" (trimmed, one space, ≤ 60 chars). */
export function cleanTopic(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60).trim();
}

/** The course id for a topic: unique per space, so asking again rebuilds the same course. */
export function topicPackType(topic: string): string {
  const slug = cleanTopic(topic)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug ? `${TOPIC_PREFIX}${slug}` : "";
}

export const isTopicPack = (packType: string) => packType.startsWith(TOPIC_PREFIX);

/** A course pack for a manager-named topic; its facts are picked by relevance to `topic`. */
export function topicPack(topic: string): CoursePack {
  const title = cleanTopic(topic).replace(/^./, (c) => c.toUpperCase());
  const style = TOPIC_STYLES.find((s) => s.re.test(title.toLowerCase()));
  return {
    packType: topicPackType(title),
    title,
    building: style?.building ?? GEN_BUILDINGS[hash(title.toLowerCase()) % GEN_BUILDINGS.length],
    icon: style?.icon ?? "book",
    game: style?.game ?? "quiz",
    desc: `${title}, from what your company brain knows.`,
    lessons: [],
    categories: ALL_CATEGORIES,
    topic: title,
  };
}

/** A default pack by id, or a topic pack (its title is the topic) for `topic-*` ids. */
export function packFor(packType: string, topicTitle?: string): CoursePack | undefined {
  if (isTopicPack(packType)) {
    const topic = topicTitle ?? packType.slice(TOPIC_PREFIX.length).replace(/-/g, " ");
    const pack = topicPack(topic);
    return { ...pack, packType };
  }
  return COURSE_PACKS.find((p) => p.packType === packType);
}
