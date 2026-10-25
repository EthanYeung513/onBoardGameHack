// The bundled stand-in world: used when neither window.OB_WORLD nor ./world.json is present (dev, demos).
// Built from the three games' sample specs (src/games/*/spec.ts), so every building plays a real game.
// `offline: true`, so the town shows its "offline stand-in content" label.
import { battleSample } from '@/games/battle/spec';
import { dilemmaSample } from '@/games/dilemma/spec';
import { wordMatchSample } from '@/games/word-match/spec';
import { WORLD_VERSION, type WorldData } from '@/lib/world/contract';

export const sampleWorld: WorldData = {
  version: WORLD_VERSION,
  company: { name: 'Mubit', host: 'mubit.ai', logoUrl: null },
  brand: { primary: '#3b5bdb', accent: '#f08c00', surface: '#ffffff', text: '#1a1b25', headingFont: 'Inter', bodyFont: 'Inter' },
  courses: [
    { id: 'security', name: 'Security & Compliance', building: 'b_clinic', reward: 50, game: 'battle', spec: battleSample },
    { id: 'vocabulary', name: 'Speak Mubit', building: 'b_shop', reward: 40, game: 'word-match', spec: wordMatchSample },
    { id: 'judgement', name: 'Hold Your Ground', building: 'b_saloon', reward: 75, game: 'dilemma', spec: dilemmaSample },
    { id: 'first-week', name: 'Your First Week', reward: 30, game: 'word-match', spec: { ...wordMatchSample, title: 'Your first week, in words' } },
  ],
  npcs: [
    { name: 'Ada', role: 'CEO', facts: ['Mubit routes model calls for teams that care about latency and cost.', 'Every all-hands ends with one thing someone learned that week.'] },
    { name: 'Gus', role: 'Head of People', facts: ['Your onboarding buddy is your first stop for any question.', 'Security training is due in your first 14 days.'] },
    { name: 'Harvey', role: 'IT Lead', facts: [] },
  ],
  facts: [
    'Mubit is OpenAI-compatible: change the base URL and the key, and calls route through us.',
    'We watch p95 latency, the slowest 5% of requests, because that is what customers notice.',
    'Cost per successful task beats cost per token as a measure of value.',
  ],
  rewards: [
    { id: 'coffee', name: 'Coffee on us', cost: 50 },
    { id: 'hoodie', name: 'Mubit hoodie', cost: 150 },
  ],
  offline: true,
  generatedAt: '2026-10-25T09:00:00.000Z',
};
