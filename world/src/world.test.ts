// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameResult } from '@/games/core/types';
import type { WorldData } from '@/lib/world/contract';
import { configure, worldConfig } from './config';
import { applyProgress, getCredits, recordResult, signInHire } from './economy';
import { apiBase } from './hireSync';
import { sampleWorld } from './sample-world';
import { generateWorld } from './worldgen';
import { instantiateGame } from '@/games/core/instantiate';
import linearWorld from './fixtures/linear-world.json';

const world = (over: Partial<WorldData> = {}): WorldData => ({
  ...sampleWorld,
  company: { name: 'Acme Pay', host: 'acmepay.com', logoUrl: 'https://acmepay.com/logo.svg' },
  brand: { ...sampleWorld.brand, primary: '#112233', accent: 'not-a-colour' },
  offline: false,
  ...over,
});

const result = (over: Partial<GameResult> = {}): GameResult => ({
  gameId: 'battle', won: true, score: 5, maxScore: 5, correct: 5, total: 5, durationMs: 1000, mistakes: [], ...over,
});

describe('WorldData -> world config', () => {
  it('maps company, brand and one building per course', () => {
    const cfg = worldConfig(world({
      courses: [
        { id: 'sec', name: 'Security', building: 'b_clinic', game: 'battle', spec: {}, reward: 80 },
        { id: 'words', name: 'Words', building: 'b_store', game: 'word-match', spec: {} }, // the shop is never a course
        { id: 'law', name: 'Judgement', building: 'nope', game: 'dilemma', spec: {} },
      ],
    }));
    expect(cfg.company).toMatchObject({ name: 'Acme Pay', host: 'acmepay.com', logoUrl: 'https://acmepay.com/logo.svg' });
    expect(cfg.brand).toEqual({ primary: '#112233', accent: '#112233' }); // invalid accent falls back to primary
    expect(cfg.courses.map(c => [c.id, c.building, c.game, c.completion])).toEqual([
      ['sec', 'b_clinic', 'battle', 0],
      ['words', undefined, 'word-match', 0],
      ['law', undefined, 'dilemma', 0],
    ]);
    expect(cfg.storageNs).toBe('ob:acmepay.com:');
    expect(cfg.offline).toBe(false);
    expect(cfg.generatedAt).toBe(sampleWorld.generatedAt);

    const town = generateWorld(cfg.courses, 1);
    const courseBuildings = town.buildings.filter(b => b.course);
    expect(courseBuildings.map(b => b.course!.id)).toEqual(['sec', 'words', 'law']);
    expect(courseBuildings[0].key).toBe('b_clinic');
    expect(new Set(courseBuildings.map(b => b.key)).has('b_store')).toBe(false);
  });

  it('maps a real published world (server build.ts output): building names cycle, every spec plays', () => {
    const cfg = worldConfig(linearWorld as WorldData);
    expect(cfg.company.name).toBe('Linear');
    expect(cfg.courses.map(c => [c.id, c.game, c.building])).toEqual([
      ['company', 'battle', undefined],
      ['people-culture', 'word-match', undefined],
      ['tools-stack', 'battle', undefined],
      ['hard-conversations', 'dilemma', undefined],
    ]);
    for (const c of cfg.courses) expect(instantiateGame({ game: c.game, spec: c.spec })).toMatchObject({ ok: true });
    expect(cfg.npcs.map(n => n.name)).not.toContain('support@linear.app');
    const keys = generateWorld(cfg.courses, 1).buildings.filter(b => b.course).map(b => b.key);
    expect(new Set(keys).size).toBe(4);
  });

  it('gives NPCs their own facts, the company facts as fallback, and a guide when there are no people', () => {
    const cfg = worldConfig(world({
      npcs: [
        { name: 'Ada', role: 'CEO', facts: ['We started in 2019.'] },
        { name: 'Bo', role: '', facts: [] },
      ],
      facts: ['Fact one', 'Fact two', 'Fact three'],
    }));
    expect(cfg.npcs).toEqual([
      { name: 'Ada', role: 'CEO', sprite: 0, facts: ['We started in 2019.'] },
      { name: 'Bo', role: 'Teammate', sprite: 1, facts: ['Fact two'] },
    ]);
    expect(worldConfig(world({ npcs: [], facts: ['Only fact'] })).npcs).toEqual([
      { name: 'Lewis', role: 'Town guide', sprite: 0, facts: ['Only fact'] },
    ]);
    expect(worldConfig(world({ npcs: [], facts: [] })).npcs).toEqual([]);
  });
});

describe('game result -> course progress and credits', () => {
  beforeEach(() => localStorage.clear());

  it('completes the course on a clear, pays its reward once, and keys storage by company host', () => {
    const cfg = worldConfig(world({ courses: [{ id: 'sec', name: 'Security', game: 'battle', spec: {}, reward: 80 }] }));
    configure(cfg);
    const [course] = cfg.courses;

    recordResult(course, result({ won: false, correct: 3, total: 4 }));
    expect(course.completion).toBe(75);
    expect(getCredits()).toBe(0);

    recordResult(course, result());
    expect(course.completion).toBe(100);
    expect(getCredits()).toBe(80);
    recordResult(course, result()); // replaying a cleared course pays nothing more
    expect(getCredits()).toBe(80);
    recordResult(course, result({ won: false, correct: 0, total: 4 })); // a worse run never lowers progress
    expect(course.completion).toBe(100);

    expect(Object.keys(localStorage).every(k => k.startsWith('ob:acmepay.com:'))).toBe(true);
    // A fresh load of the same company restores it; another company starts from zero.
    expect(applyProgress(worldConfig(world({ courses: [{ id: 'sec', name: 'Security', game: 'battle', spec: {} }] })).courses)[0].completion).toBe(100);
    const other = worldConfig(world({ company: { name: 'Globex', host: 'globex.io', logoUrl: null }, courses: [{ id: 'sec', name: 'Security', game: 'battle', spec: {} }] }));
    configure(other);
    expect(applyProgress(other.courses)[0].completion).toBe(0);
    expect(getCredits()).toBe(0);
  });

  it('gives every email its own progress and credits: switching hire starts fresh, coming back restores', () => {
    const cfg = worldConfig(world({ courses: [{ id: 'sec', name: 'Security', game: 'battle', spec: {} }] }));
    configure(cfg);
    const [course] = cfg.courses;

    signInHire('A@x.com ', cfg.courses);
    recordResult(course, result());
    expect([course.completion, getCredits()]).toEqual([100, 50]);

    signInHire('b@x.com', cfg.courses);
    expect([course.completion, getCredits()]).toEqual([0, 0]);
    recordResult(course, result({ won: false, correct: 1, total: 4 }));

    signInHire('a@x.com', cfg.courses); // same hire, any casing
    expect([course.completion, getCredits()]).toEqual([100, 50]);
    expect(Object.keys(localStorage).filter(k => k.startsWith('ob:acmepay.com:a%40x.com:')).length).toBeGreaterThan(0);
    expect(Object.keys(localStorage).filter(k => k.startsWith('ob:acmepay.com:b%40x.com:')).length).toBeGreaterThan(0);
  });

  it('reports to the space API only when served from /o/<slug>', () => {
    expect(apiBase('/o/acme-pay')).toBe('/o/acme-pay/api');
    expect(apiBase('/o/acme-pay/index.html')).toBe('/o/acme-pay/api');
    expect(apiBase('/')).toBeNull();
  });

  it('never completes a course without a clear', () => {
    const cfg = worldConfig(world());
    configure(cfg);
    recordResult(cfg.courses[0], result({ won: false, correct: 10, total: 10 }));
    expect(cfg.courses[0].completion).toBe(99);
    expect(getCredits()).toBe(0);
  });
});

describe('world_opened slug', () => {
  it('reads the space slug from /o/<slug>, else falls back to the company host', async () => {
    const { spaceSlug } = await import('./analytics');
    expect(spaceSlug('/o/linear', 'linear.app')).toBe('linear');
    expect(spaceSlug('/o/acme-pay/', 'acme.com')).toBe('acme-pay');
    expect(spaceSlug('/', 'acme.com')).toBe('acme.com');
  });
});
