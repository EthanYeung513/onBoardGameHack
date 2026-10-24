// The three variants generated for every project, each with a clearly different gamification style.
export const VARIANTS = [
  {
    key: "quest",
    style: "quest_path",
    brief:
      "A quest path. The new user travels a path map through named stations, earns points at each station and unlocks badges at milestones. Use slide and morph transitions between stations. Progress uses a path_map.",
  },
  {
    key: "streak",
    style: "checklist_streak",
    brief:
      "A checklist with streaks. Short, satisfying setup tasks the user ticks off in a row, with a visible streak indicator and a progress bar. Use stagger reveals for checklist items and fade between steps.",
  },
  {
    key: "quiz",
    style: "quiz_tour",
    brief:
      "A quiz-led tour. Feature tour cards alternate with quick quiz questions about what the product does, rewarding correct answers. Use scale and stagger transitions. End with a summary of what they learned.",
  },
] as const;
export type VariantKey = (typeof VARIANTS)[number]["key"];
