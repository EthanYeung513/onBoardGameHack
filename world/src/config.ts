// World config: everything company-specific comes from one WorldData object (src/lib/world/contract.ts),
// which main.tsx loads (data.ts) and hands to configure() before the app renders. `worldConfig` is the
// pure mapping (tested); the live bindings below are what the screens and the Phaser scene read.
import type { GameId } from '@/games/core/types';
import type { WorldData } from '@/lib/world/contract';
import { BUILDINGS } from './worldgen';

export interface Course {
  id: string;
  name: string;
  desc?: string;
  building?: string; // key into worldgen BUILDINGS; omitted -> BUILDING_CYCLE
  completion: number; // 0-100
  reward?: number; // credits paid on completion; omitted -> DEFAULT_COURSE_REWARD (economy.ts)
  game: GameId;
  spec: unknown;
  staleSteps?: number;
}

export interface Npc {
  name: string;
  role: string;
  sprite: number; // index into n{0-3}.png / portraits strip
  facts: string[];
}

export interface Reward { id: string; name: string; cost: number }

export interface Company {
  name: string;
  host: string;
  logoUrl: string | null;
  tagline: string;
}

export interface WorldConfig {
  company: Company;
  brand: { primary: string; accent: string };
  courses: Course[];
  npcs: Npc[];
  facts: string[];
  rewards: Reward[];
  offline: boolean;
  generatedAt: string;
  /** The company's namespace (`ob:<host>:`): two companies on one origin never share progress. */
  companyNs: string;
  /** Prefix for every localStorage key: the company's namespace until a hire signs in, then the
   * hire's own (`ob:<host>:<email>:`, see economy.ts signInHire), so each email has its own state. */
  storageNs: string;
}

const NPC_SPRITES = 4; // n0..n3 + portraits.png cells
const MAX_NPCS = 8;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const FALLBACK_BRAND = { primary: '#4f9c2e', accent: '#2e98ff' };

const hostOf = (company: WorldData['company']) =>
  (company.host || company.name || 'company').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() || 'company';

/** Fallback chatter: deal the company facts out round-robin so each NPC says something different. */
function dealFacts(facts: string[], i: number, n: number): string[] {
  return facts.filter((_, j) => j % n === i);
}

/** Map a WorldData (the server's world.json) to what the town renders. Pure. */
export function worldConfig(data: WorldData): WorldConfig {
  const name = data.company.name?.trim() || 'Your company';
  const facts = (data.facts ?? []).map(f => f.trim()).filter(Boolean);
  const courses: Course[] = (data.courses ?? []).map((c, i) => ({
    id: c.id || `c${i}`,
    name: c.name,
    desc: c.desc,
    building: c.building && BUILDINGS[c.building] && c.building !== 'b_store' && c.building !== 'b_townhall' ? c.building : undefined,
    completion: 0,
    reward: c.reward,
    game: c.game,
    spec: c.spec,
    staleSteps: c.staleSteps,
  }));

  // A townsperson needs a name a person would have: mailbox addresses ("support@...") stay out of town.
  const people = (data.npcs ?? []).filter(n => n.name?.trim() && !n.name.includes('@')).slice(0, MAX_NPCS);
  let npcs: Npc[] = people.map((n, i) => ({
    name: n.name.trim(),
    role: n.role?.trim() || 'Teammate',
    sprite: i % NPC_SPRITES,
    facts: n.facts?.filter(Boolean).length ? n.facts.filter(Boolean) : dealFacts(facts, i, people.length),
  }));
  // No people in the data but company facts: one guide shares them, so the plaza still talks.
  if (!npcs.length && facts.length) npcs = [{ name: 'Lewis', role: 'Town guide', sprite: 0, facts }];
  // An NPC with nothing to say still greets the hire.
  npcs = npcs.map(n => (n.facts.length ? n : { ...n, facts: [`Welcome to ${name}! Glad you're here.`] }));

  const primary = HEX.test(data.brand?.primary ?? '') ? data.brand.primary : FALLBACK_BRAND.primary;
  const accent = HEX.test(data.brand?.accent ?? '') ? data.brand.accent : primary;

  const host = hostOf(data.company);
  return {
    company: { name, host, logoUrl: data.company.logoUrl || null, tagline: 'Learn the tribe, not just the tools' },
    brand: { primary, accent },
    courses,
    npcs,
    facts,
    rewards: (data.rewards ?? []).filter(r => r.name && Number(r.cost) >= 0),
    offline: !!data.offline,
    generatedAt: data.generatedAt,
    companyNs: `ob:${host}:`,
    storageNs: `ob:${host}:`,
  };
}

// ---------- live bindings (set once by configure(), before the app renders) ----------
export let WORLD: WorldConfig;
export let COMPANY: Company;
export let COURSES: Course[] = [];
export let NPCS: Npc[] = [];
export let SHOP_NAME = 'Store';

export function configure(cfg: WorldConfig) {
  WORLD = cfg;
  COMPANY = cfg.company;
  COURSES = cfg.courses;
  NPCS = cfg.npcs;
  // the rewards shop building (a fixed landmark; catalogue lives in economy.ts)
  SHOP_NAME = `${cfg.company.name} Store`;
}
