import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { PASSAGES_PER_CALL } from "@/worker/brain/batch";
import { FIRST_PASS_PASSAGES, PACKS_IN_FLIGHT, seedBrainStage } from "@/worker/stages/seed-brain";
import type { StageContext } from "@/worker/types";

// seed_brain throughput: passages packed into few Mubit calls run in parallel; packs commit in
// order (one mutation each); a scan's first pass hands the long tail to a background job.

function harness(n: number, opts: { scanId?: string } = {}) {
  const chunks = Array.from({ length: n }, (_, i) => ({ id: `ch${i}`, text: `Passage ${i}: Deploys happen on Tuesdays.`, sourceItemId: "si", title: `Page ${i}`, kind: "page", connectorType: "website", obsolete: false }));
  let pending = [...chunks];
  let inFlight = 0;
  let peak = 0;
  const calls: number[] = [];
  const commits: string[][] = [];
  const events: string[] = [];
  const name = (fn: unknown) => getFunctionName(fn as never);
  const ctx = {
    space: { _id: "s1", name: "Acme" },
    job: { cursor: {}, scanId: opts.scanId },
    llm: {
      live: true,
      json: vi.fn(async (req: { user: string }) => {
        const ids = [...req.user.matchAll(/Passage id: (p\d+)/g)].map((m) => m[1]);
        calls.push(ids.length);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { value: { results: ids.map((id) => ({ id, facts: [], entities: [], edges: [] })) }, mode: "live", model: "gpt-x", requestId: null };
      }),
    },
    embed: { mode: "live", embed: vi.fn(async () => []) },
    convex: {
      query: vi.fn(async (fn: unknown, args: { limit?: number }) => {
        if (name(fn) === "brainWorker:rejectedExamples") return [];
        if (name(fn) === "brainWorker:pendingCount") return pending.length;
        if (name(fn) === "brainWorker:pendingChunks") return pending.slice(0, args.limit);
        return [];
      }),
      mutation: vi.fn(async (fn: unknown, args: { chunks: { chunkId: string }[] }) => {
        if (name(fn) !== "brainWorker:commitChunks") return null;
        commits.push(args.chunks.map((c) => c.chunkId));
        pending = pending.filter((c) => !args.chunks.some((x) => x.chunkId === c.id));
        return args.chunks.map(() => ({ skipped: false, entitiesCreated: 1, facts: { created: 2, cited: 0, refreshed: 0, duplicate: 0, suppressed: 0 } }));
      }),
    },
    remainingMs: () => 180_000,
    lost: () => false,
    progress: vi.fn(async () => undefined),
    event: vi.fn(async (_l: string, m: string) => void events.push(m)),
  } as unknown as StageContext;
  return { ctx, chunks, calls, commits, events, peak: () => peak, pending: () => pending.length };
}

describe("seed_brain batching", () => {
  it("packs passages into few parallel calls and commits pack by pack, in order", async () => {
    const h = harness(25);
    const r = await seedBrainStage.run(h.ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "cascade" }] });
    expect(h.calls).toEqual([PASSAGES_PER_CALL, PASSAGES_PER_CALL, 25 - 2 * PASSAGES_PER_CALL]); // 25 passages → 3 calls, not 25
    expect(h.peak()).toBeGreaterThan(1);
    expect(h.peak()).toBeLessThanOrEqual(PACKS_IN_FLIGHT);
    expect(h.commits.flat()).toEqual(h.chunks.map((c) => c.id));
    expect(h.commits).toHaveLength(3);
    expect(h.events.at(-1)).toContain("25/25 passages · 25 entities so far");
  });

  it("a scan's first pass stops at the cap and continues the rest as a detached background job", async () => {
    const h = harness(FIRST_PASS_PASSAGES + 30, { scanId: "scan1" });
    const r = await seedBrainStage.run(h.ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "seed_brain", detached: true }, { stage: "cascade" }] });
    expect(h.pending()).toBe(30);
    expect(h.events[0]).toContain(`(the first ${FIRST_PASS_PASSAGES} now, the rest in the background)`);
  });
});
