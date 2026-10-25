// Tells the manager's dashboard about the hire playing this world: who signed in, and each course
// game they finish. The world is served at /o/<slug>; it posts to that space's small API
// (/o/<slug>/api/hire, /o/<slug>/api/progress, see src/app/o/[slug]/[[...path]]/route.ts).
//
// Fire-and-forget: a failed or offline call never blocks play. Calls retry with backoff, and the
// ones still pending wait in localStorage (per hire) and go out on the next sign-in. Outside /o/<slug>
// (vite dev, a static host) there is no backend, so nothing is sent.
import type { GameResult } from '@/games/core/types';
import { WORLD, type Course } from './config';
import { normaliseEmail } from './economy';

type Call = { path: 'hire' | 'progress'; body: Record<string, unknown> };

const RETRY_MS = [1_000, 4_000, 15_000, 60_000];
const MAX_OUTBOX = 50;

let hire: { email: string; name: string } | null = null;

/** `/o/<slug>` when the world is served by the app; null in dev or on a static host. */
export function apiBase(path = typeof location === 'undefined' ? '' : location.pathname): string | null {
  const m = /^\/o\/([^/]+)/.exec(path);
  return m ? `/o/${m[1]}/api` : null;
}

const outboxKey = () => `${WORLD?.storageNs ?? 'ob:'}outbox`;
function readOutbox(): Call[] {
  try { return JSON.parse(localStorage.getItem(outboxKey()) ?? '[]') as Call[]; } catch { return []; }
}
function writeOutbox(calls: Call[]) {
  try { localStorage.setItem(outboxKey(), JSON.stringify(calls.slice(-MAX_OUTBOX))); } catch { /* quota: retries stay in memory */ }
}

async function post(call: Call): Promise<'ok' | 'retry' | 'drop'> {
  const base = apiBase();
  if (!base) return 'drop';
  try {
    const r = await fetch(`${base}/${call.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(call.body),
      keepalive: true,
    });
    if (r.ok) return 'ok';
    // 4xx means the request itself is wrong (bad email, unknown course): retrying won't help.
    return r.status === 429 || r.status >= 500 ? 'retry' : 'drop';
  } catch {
    return 'retry';
  }
}

function send(call: Call, attempt = 0) {
  if (!apiBase()) return;
  const key = outboxKey();
  void post(call).then(outcome => {
    if (outcome === 'retry' && attempt < RETRY_MS.length) {
      setTimeout(() => send(call, attempt + 1), RETRY_MS[attempt]);
      return;
    }
    // Settled (sent, rejected, or out of retries for now): only an unsent call stays in the outbox.
    if (key !== outboxKey()) return;
    const rest = readOutbox().filter(c => JSON.stringify(c) !== JSON.stringify(call));
    writeOutbox(outcome === 'retry' ? [...rest, call] : rest);
  });
}

function queue(call: Call) {
  if (!apiBase()) return;
  writeOutbox([...readOutbox(), call]);
  send(call);
}

/** The hire signed in: register them with the space, then flush anything left from earlier sessions. */
export function reportJoin(h: { email: string; name: string }) {
  hire = { email: normaliseEmail(h.email), name: h.name.trim() };
  const pending = readOutbox();
  send({ path: 'hire', body: { ...hire } });
  for (const call of pending) send(call);
}

/** A course's game finished: its result moves the hire's progress on the dashboard. */
export function reportResult(course: Course, result: GameResult) {
  if (!hire) return;
  queue({
    path: 'progress',
    body: {
      email: hire.email,
      name: hire.name,
      course: course.id,
      won: result.won,
      correct: result.correct,
      total: result.total,
    },
  });
}
