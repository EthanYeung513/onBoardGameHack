// World config — later this comes from the manager dashboard / generated world spec.
// For now it's the mock: one building per course, NPCs with company fun facts.

export interface Course {
  id: string;
  name: string;
  building: 'b_townhall' | 'b_barn' | 'b_coop' | 'b_stable' | 'b_silo' | 'b_well';
  completion: number; // 0-100
}

export interface Npc {
  name: string;
  role: string;
  sprite: number; // index into n{0-3}.png / portraits strip
  facts: string[];
}

export const COMPANY = {
  name: 'Orthogonal',
  tagline: 'Learn the tribe, not just the tools',
};

const BUILDING_CYCLE: Course['building'][] = ['b_coop', 'b_barn', 'b_stable', 'b_silo', 'b_well'];

function loadCourses(): Course[] {
  // Dashboard integration hook: if the manager dashboard saved a world spec, use it.
  try {
    const raw = localStorage.getItem('ob_courses');
    if (raw) {
      const arr = JSON.parse(raw) as { id?: string; name: string; completion?: number }[];
      if (Array.isArray(arr) && arr.length) {
        return arr.map((c, i) => ({
          id: c.id ?? `c${i}`,
          name: c.name,
          building: BUILDING_CYCLE[i % BUILDING_CYCLE.length],
          completion: c.completion ?? 0,
        }));
      }
    }
  } catch { /* fall through */ }
  return [
    { id: 'c1', name: 'Company Values & Culture', building: 'b_coop', completion: 80 },
    { id: 'c2', name: 'Security & Compliance', building: 'b_silo', completion: 45 },
    { id: 'c3', name: 'Product Deep Dive', building: 'b_stable', completion: 15 },
    { id: 'c4', name: 'Tools & Workflow', building: 'b_barn', completion: 0 },
    { id: 'c5', name: 'Your First Week', building: 'b_well', completion: 0 },
  ];
}

export const COURSES: Course[] = loadCourses();

export const NPCS: Npc[] = [
  {
    name: 'Lewis',
    role: 'CEO',
    sprite: 0,
    facts: [
      `${COMPANY.name} was founded in a garage with exactly two desks and one very loud espresso machine.`,
      `Our first customer still uses us today — and still gets the original pricing.`,
      `Every all-hands ends with someone sharing one thing they learned that week.`,
    ],
  },
  {
    name: 'Gus',
    role: 'Head of People',
    sprite: 1,
    facts: [
      `We do "demo Fridays" — anyone can show anything they're working on, work-related or not.`,
      `Your onboarding buddy is your first port of call for literally any question. No question is too small.`,
      `Benefits enrollment closes at the end of your first month — don't leave it to the last day.`,
    ],
  },
  {
    name: 'Harvey',
    role: 'IT Lead',
    sprite: 2,
    facts: [
      `If a login is ever broken, the #it-help channel answers faster than email.`,
      `We rotate credentials quarterly — you'll get a prompt before anything expires.`,
      `Fun fact: the office wifi password changes every sprint. It's always a pun.`,
    ],
  },
  {
    name: 'Pierre',
    role: 'Ops Manager',
    sprite: 3,
    facts: [
      `The best parking spots are taken by 8:30. The second-best are by the east entrance.`,
      `Kitchen rule #1: label your food or accept the consequences.`,
      `Ship dates are sacred, but so is lunch. We block 12–1pm for everyone.`,
    ],
  },
];
