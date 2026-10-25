// Credits economy: hires earn credits for onboarding progress and spend them
// in the rewards shop. State lives in localStorage, every key prefixed with
// the company's namespace (`ob:<host>:`, WORLD.storageNs) so two companies
// served from one origin never share progress:
//
//   credits   number               current balance
//   awarded   string[]             course ids already paid out (no double-pay)
//   progress  {[courseId]: 0-100}  completion earned in the world (game results)
//   redeemed  Redemption[]         purchase log
//
// The shop catalogue comes from WorldData.rewards (icons matched by id, else
// a treasure chest); with no rewards the default catalogue is used.
//
// Dev-only URL params: ?credits=N sets the balance, ?complete=all|c1,c2 marks
// courses complete (in memory), ?reset=1 clears all of the above first.
import type { GameResult } from '@/games/core/types';
import { WORLD, type Course } from './config';

export const DEFAULT_COURSE_REWARD = 50;

/** A crop of one of the sheets in public/assets (pixel rect). */
export interface Icon { sheet: string; rect: [number, number, number, number] }
export interface ShopItem {
  id: string;
  name: string;
  cost: number;
  icon: Icon;
  blurb?: string;
  limit?: number; // max redemptions per hire; default 1, 0 = unlimited
}
export interface Redemption { id: string; name: string; cost: number; at: string }

const ns = () => WORLD?.storageNs ?? 'ob:';
const K = {
  get credits() { return `${ns()}credits`; },
  get awarded() { return `${ns()}awarded`; },
  get progress() { return `${ns()}progress`; },
  get redeemed() { return `${ns()}redeemed`; },
};
const devParams = () => (import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams());

function read<X>(key: string, fallback: X): X {
  try { const raw = localStorage.getItem(key); if (raw != null) return JSON.parse(raw) as X; } catch { /* ignore */ }
  return fallback;
}
function write(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ }
}

/** Dev-only URL params (?reset, ?credits=N). Called once after configure(). */
export function applyDevParams() {
  const dev = devParams();
  if (dev.has('reset')) [K.credits, K.awarded, K.progress, K.redeemed].forEach(k => { try { localStorage.removeItem(k); } catch { /* ignore */ } });
  if (dev.has('credits')) write(K.credits, Math.max(0, Math.floor(Number(dev.get('credits')) || 0)));
}

// ---------- balance + change events ----------
export interface CreditEvent { balance: number; delta: number; reason: string }
const listeners = new Set<(e: CreditEvent) => void>();
export function onCredits(fn: (e: CreditEvent) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function getCredits(): number {
  const n = Number(read(K.credits, 0));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
function change(delta: number, reason: string) {
  const balance = Math.max(0, getCredits() + delta);
  write(K.credits, balance);
  listeners.forEach(fn => fn({ balance, delta, reason }));
}

// ---------- earning: course completion ----------
export const courseReward = (c: Course) => c.reward ?? DEFAULT_COURSE_REWARD;

/** Pay out every complete course that hasn't been paid yet. Returns the payouts. */
export function awardCompleted(courses: Course[]): { course: Course; amount: number }[] {
  const awarded = new Set(read<string[]>(K.awarded, []));
  const out: { course: Course; amount: number }[] = [];
  for (const c of courses) {
    if (c.completion < 100 || awarded.has(c.id)) continue;
    awarded.add(c.id);
    out.push({ course: c, amount: courseReward(c) });
  }
  if (!out.length) return out;
  write(K.awarded, [...awarded]);
  for (const p of out) change(p.amount, `Completed ${p.course.name}`);
  return out;
}

/** Overlay world-earned progress and dev ?complete= onto the course list. */
export function applyProgress(courses: Course[]): Course[] {
  const prog = read<Record<string, number>>(K.progress, {});
  const done = (devParams().get('complete') ?? '').split(',').filter(Boolean);
  for (const c of courses) {
    c.completion = Math.max(c.completion, Number(prog[c.id]) || 0);
    if (done.includes('all') || done.includes(c.id)) c.completion = 100;
  }
  return courses;
}

/** Record progress on a course (mutates it so hover tooltips update) and pay out on completion. Never goes down. */
export function setProgress(c: Course, pct: number) {
  c.completion = Math.max(c.completion, Math.min(100, Math.round(pct)));
  const prog = read<Record<string, number>>(K.progress, {});
  prog[c.id] = c.completion;
  write(K.progress, prog);
  return awardCompleted([c]);
}

/**
 * A course's game reported its result: a cleared run completes the course (and pays its reward),
 * otherwise the course keeps the best accuracy so far, capped below 100 so only a clear completes it.
 */
export function recordResult(c: Course, result: GameResult) {
  const pct = result.won ? 100 : Math.min(99, result.total ? Math.round((result.correct / result.total) * 100) : 0);
  return setProgress(c, pct);
}

// ---------- spending: the shop ----------
const objIcon = (i: number): Icon => ({ sheet: 'objects', rect: [(i % 24) * 16, Math.floor(i / 24) * 16, 16, 16] });
// shirts.png: 16 shirts per row, 8x32 each (front view = top 8x8)
const shirtIcon = (i: number): Icon => ({ sheet: 'shirts', rect: [(i % 16) * 8, Math.floor(i / 16) * 32, 8, 8] });

const DEFAULT_SHOP: ShopItem[] = [
  { id: 'coffee', name: 'Starbucks coupon', cost: 50, icon: objIcon(395), blurb: 'One handcrafted drink, on us.', limit: 0 },
  { id: 'stickers', name: 'Laptop sticker pack', cost: 75, icon: objIcon(74), blurb: 'Holographic team stickers.' },
  { id: 'hoodie', name: 'Company hoodie', cost: 150, icon: shirtIcon(25), blurb: 'Cozy, navy, brand new.' },
  { id: 'dayoff', name: 'Day off voucher', cost: 250, icon: objIcon(98), blurb: 'Take a full day, guilt free.' },
];

function loadShop(): ShopItem[] {
  const arr: Partial<ShopItem>[] | undefined = WORLD?.rewards;
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_SHOP;
  const out: ShopItem[] = [];
  arr.forEach((it, i) => {
    if (!it?.name || !(Number(it.cost) >= 0)) return;
    const base = DEFAULT_SHOP.find(d => d.id === it.id);
    out.push({
      id: it.id ?? `s${i}`,
      name: it.name,
      cost: Math.floor(Number(it.cost)),
      icon: it.icon ?? base?.icon ?? objIcon(166 /* treasure chest */),
      blurb: it.blurb ?? base?.blurb,
      limit: it.limit ?? base?.limit,
    });
  });
  return out.length ? out : DEFAULT_SHOP;
}
let shop: ShopItem[] | null = null;
export const shopItems = (): ShopItem[] => (shop ??= loadShop());

export const getRedeemed = () => read<Redemption[]>(K.redeemed, []);
export const ownedCount = (id: string) => getRedeemed().filter(r => r.id === id).length;
export const soldOut = (it: ShopItem) => (it.limit ?? 1) > 0 && ownedCount(it.id) >= (it.limit ?? 1);

/** Spend credits on an item. Returns false if unaffordable or already at its limit. */
export function redeem(it: ShopItem): boolean {
  if (getCredits() < it.cost || soldOut(it)) return false;
  write(K.redeemed, [...getRedeemed(), { id: it.id, name: it.name, cost: it.cost, at: new Date().toISOString() }]);
  change(-it.cost, `Redeemed ${it.name}`);
  return true;
}
