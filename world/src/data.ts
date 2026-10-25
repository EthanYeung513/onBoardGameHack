// Where the world's content comes from, in order:
//   1. window.OB_WORLD: the WorldData the server inlines into index.html (production: /o/<slug>).
//   2. ./world.json next to index.html (dev, or a static host serving the bundle with a data file).
//   3. The bundled sample world (sample-world.ts), labelled as offline stand-in content.
import type { WorldData } from '@/lib/world/contract';
import { WORLD_VERSION } from '@/lib/world/contract';

declare global {
  interface Window { OB_WORLD?: WorldData }
}

export type WorldSource = 'inline' | 'world.json' | 'sample';

export function isWorldData(v: unknown): v is WorldData {
  const d = v as WorldData | null;
  return !!d && typeof d === 'object' && d.version === WORLD_VERSION && !!d.company?.name && Array.isArray(d.courses);
}

export async function loadWorldData(): Promise<{ data: WorldData; source: WorldSource }> {
  if (isWorldData(window.OB_WORLD)) return { data: window.OB_WORLD, source: 'inline' };
  try {
    const r = await fetch('./world.json', { cache: 'no-store' });
    if (r.ok) {
      const json: unknown = await r.json();
      if (isWorldData(json)) return { data: json, source: 'world.json' };
    }
  } catch { /* no data file: use the sample */ }
  const { sampleWorld } = await import('./sample-world');
  return { data: sampleWorld, source: 'sample' };
}
