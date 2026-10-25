import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { EXTRACT_CONCURRENCY, seedBrainStage } from "@/worker/stages/seed-brain";
import type { StageContext } from "@/worker/types";

// seed_brain: model calls in parallel (bounded), commits strictly in chunk order, running totals.

describe("seed_brain throughput", () => {
  it("runs extraction calls in parallel, commits in order, and reports running progress", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({ id: `ch${i}`, text: `Passage ${i}`, sourceItemId: "si", title: `Page ${i}`, kind: "page", connectorType: "website", obsolete: false }));
    let pending = [...chunks];
    let inFlight = 0;
    let peak = 0;
    const commits: string[] = [];
    const events: string[] = [];
    const name = (fn: unknown) => getFunctionName(fn as never);
    const ctx = {
      space: { _id: "s1", name: "Acme" },
      job: { cursor: {} },
      llm: {
        live: true,
        json: vi.fn(async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return { value: { facts: [], entities: [], edges: [] }, mode: "live", model: "gpt-x", requestId: null };
        }),
      },
      embed: { mode: "live", embed: vi.fn(async () => []) },
      convex: {
        query: vi.fn(async (fn: unknown) => {
          if (name(fn) === "brainWorker:rejectedExamples") return [];
          if (name(fn) === "brainWorker:pendingCount") return pending.length;
          if (name(fn) === "brainWorker:pendingChunks") return pending.slice(0, 8);
          return null;
        }),
        mutation: vi.fn(async (fn: unknown, args: { chunkId: string }) => {
          if (name(fn) === "brainWorker:commitChunk") {
            commits.push(args.chunkId);
            pending = pending.filter((c) => c.id !== args.chunkId);
            return { skipped: false, entitiesCreated: 1, facts: { created: 2, approved: 2, draft: 0, duplicate: 0, suppressed: 0 } };
          }
          return null;
        }),
      },
      remainingMs: () => 60_000,
      lost: () => false,
      progress: vi.fn(async () => undefined),
      event: vi.fn(async (_l: string, m: string) => void events.push(m)),
    } as unknown as StageContext;

    const r = await seedBrainStage.run(ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "cascade" }] });
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(EXTRACT_CONCURRENCY);
    expect(commits).toEqual(chunks.map((c) => c.id));
    expect(events[0]).toBe("10 new or changed passages to learn from");
    expect(events.at(-1)).toContain("10/10 passages · 10 entities so far");
  });
});
