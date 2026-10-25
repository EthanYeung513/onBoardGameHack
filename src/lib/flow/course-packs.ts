import type { CourseGame } from "./course-spec";

// The four default courses, exactly as the mockup's state.js `COURSES` (title, building, icon,
// game, description, lesson outline). Each pack is built from the brain categories that feed it.
// `packType` is the upsert key with the space (courses.by_space_pack).

export type FactCategory = "Glossary" | "People" | "Tools" | "Rituals" | "Docs & History" | "Policy" | "Product" | "Other";

export interface CoursePack {
  packType: "company" | "people" | "tools" | "conversations";
  title: string;
  building: string;
  icon: string;
  game: CourseGame;
  desc: string;
  /** The mockup's course plan — an outline hint for the model, not content. */
  lessons: string[];
  /** Brain categories this course teaches, most important first. */
  categories: FactCategory[];
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
    packType: "people",
    title: "People & Culture",
    building: "Community Hall",
    icon: "users",
    game: "inbox",
    desc: "Who's who, rituals, birthdays and unwritten rules.",
    lessons: ["Org map", "Rituals & rhythms", "Unwritten rules"],
    categories: ["People", "Rituals"],
  },
  {
    packType: "tools",
    title: "Tools & Stack",
    building: "Workshop",
    icon: "wrench",
    game: "road",
    desc: "The stack you'll live in: repos, boards, deploys.",
    lessons: ["Repos & CI", "Boards & tickets", "Ship to prod"],
    categories: ["Tools"],
  },
  {
    packType: "conversations",
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
/** At most this many facts go into one course prompt (highest confidence first). */
export const MAX_FACTS_PER_COURSE = 24;

export function packFor(packType: string): CoursePack | undefined {
  return COURSE_PACKS.find((p) => p.packType === packType);
}
