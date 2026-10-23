/**
 * The Acme Pay office as a tile grid. Placeholder art (see DECISIONS.md D-8): swap for a Tiled export later,
 * keeping the same legend.
 *
 *   #  wall          ,  floor        .  path        "  long grass (wild phishing encounters)
 *   B  building      lowercase letter: a building's door (see DOORS)
 */
const GRASS_ROW = "#" + '"'.repeat(3) + "." + '"'.repeat(10) + "." + ",".repeat(10) + "." + ",,#";

export const OFFICE_MAP = [
  "##############################",
  "#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#",
  "#,BBBBB,,,,,,BBBBB,,,,,,BBBBB#",
  "#,BBBBB,,,,,,BBBBB,,,,,,BBBBB#",
  "#,BBtBB,,,,,,BBsBB,,,,,,BBuBB#",
  "#,,,.,,,,,,,,,,.,,,,,,,,,,.,,#",
  "#,,,.......................,,#",
  "#,,,.,,,,,,,,,,.,,,,,,,,,,.,,#",
  GRASS_ROW,
  GRASS_ROW,
  GRASS_ROW,
  "#,,,.,,,,,,,,,,.,,,,,,,,,,.,,#",
  "#,,,.......................,,#",
  "#,,,.,,,,,,,,,,.,,,,,,,,,,.,,#",
  "#,BBeBB,,,,,,BBnBB,,,,,,BBdBB#",
  "#,BBBBB,,,,,,BBBBB,,,,,,BBBBB#",
  "#,BBBBB,,,,,,BBBBB,,,,,,BBBBB#",
  "#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#",
  "#,,,,,,,,,,,,,,,,,,,,,,,,,,,,#",
  "##############################",
];

/** Door letter -> building id. Building ids match `gyms.building` (plus `desk` for the passport). */
export const DOORS: Record<string, { building: string; label: string }> = {
  t: { building: "townhall", label: "Town Hall" },
  s: { building: "security", label: "Security HQ" },
  u: { building: "support", label: "Support Gym" },
  e: { building: "engineering", label: "Engineering Gym" },
  n: { building: "annex", label: "New Pack" },
  d: { building: "desk", label: "Your Desk" },
};

export const SPAWN = { x: 15, y: 6 };
