import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { PASSAGES_PER_CALL } from "@/worker/brain/batch";
import { FIRST_PACK, FIRST_PASS_PASSAGES, PACKS_IN_FLIGHT, seedBrainStage } from "@/worker/stages/seed-brain";
import type { StageContext } from "@/worker/types";

// seed_brain throughput: one triage call labels many passages; high passages stream into small
// parallel extraction calls; each finished call commits at once (one mutation each); a scan's
// first pass hands the long tail to a background job.

type Label = "high" | "low" | "skip";

function harness(n: number, opts: { scanId?: string; delay?: (ids: string[]) => number; fail?: (ids: string[]) => boolean; label?: (i: number) => Label } = {}) {
  const chunks = Array.from({ length: n }, (_, i) => ({ id: `ch${i}`, text: `Passage ${i}: Deploys happen on Tuesdays.`, sourceItemId: "si", title: `Page ${i}`, kind: "page", connectorType: "website", obsolete: false, label: null }));
  let pending = [...chunks];
  const labels = new Map<string, Label>();
  let inFlight = 0;
  let peak = 0;
  const calls: string[][] = [];
  const commits: string[][] = [];
  const events: string[] = [];
  const name = (fn: unknown) => getFunctionName(fn as never);
  const ctx = {
    space: { _id: "s1", name: "Acme" },
    job: { cursor: {}, scanId: opts.scanId },
    llm: {
      live: true,
      json: vi.fn(async (req: { task: string; user: string }) => {
        if (req.task === "brain_classify") {
          const ids = [...req.user.matchAll(/### id: (c\d+)\nSource: \S+ \S+ \| Page (\d+)/g)];
          return { value: { results: ids.map((m) => ({ id: m[1], value: opts.label?.(Number(m[2])) ?? "high", reason: "" })) }, mode: "live", model: "gpt-x", requestId: null };
        }
        const ids = [...req.user.matchAll(/Passage id: (p\d+)/g)].map((m) => m[1]);
        const pages = [...req.user.matchAll(/website page — Page (\d+)/g)].map((m) => `ch${m[1]}`);
        calls.push(pages);
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, opts.delay?.(pages) ?? 5));
        inFlight--;
        if (opts.fail?.(pages)) throw new Error("gateway 502");
        return { value: { results: ids.map((id) => ({ id, facts: [], entities: [], edges: [] })) }, mode: "live", model: "gpt-x", requestId: null };
      }),
    },
    embed: { mode: "live", embed: vi.fn(async () => []) },
    convex: {
      query: vi.fn(async (fn: unknown, args: { limit?: number; label?: string }) => {
        if (name(fn) === "brainWorker:rejectedExamples") return [];
        if (name(fn) === "brainWorker:pendingCount") return pending.length;
        if (name(fn) === "brainWorker:pendingChunks") {
          const want = args.label === "none" ? undefined : args.label;
          return pending.filter((c) => labels.get(c.id) === want).slice(0, args.limit).map((c) => ({ ...c, label: labels.get(c.id) ?? null }));
        }
        return [];
      }),
      mutation: vi.fn(async (fn: unknown, args: { chunks?: { chunkId: string }[]; items?: { chunkId: string; value: Label }[] }) => {
        if (name(fn) === "brainWorker:labelChunks") {
          for (const it of args.items!) {
            labels.set(it.chunkId, it.value);
            if (it.value === "skip") pending = pending.filter((c) => c.id !== it.chunkId);
          }
          return { high: 0, low: 0, skip: 0 };
        }
        if (name(fn) !== "brainWorker:commitChunks") return null;
        commits.push(args.chunks!.map((c) => c.chunkId));
        pending = pending.filter((c) => !args.chunks!.some((x) => x.chunkId === c.id));
        return args.chunks!.map(() => ({ skipped: false, entitiesCreated: 1, facts: { created: 2, cited: 0, refreshed: 0, duplicate: 0, suppressed: 0 } }));
      }),
    },
    remainingMs: () => 180_000,
    lost: () => false,
    progress: vi.fn(async () => undefined),
    event: vi.fn(async (_l: string, m: string) => void events.push(m)),
  } as unknown as StageContext;
  return { ctx, chunks, calls, commits, events, labels, peak: () => peak, pending: () => pending.length };
}

describe("seed_brain streaming", () => {
  it("starts with a small pack, runs packs in parallel and commits every passage exactly once", async () => {
    const h = harness(40);
    const r = await seedBrainStage.run(h.ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "cascade" }] });
    expect(h.calls[0]).toHaveLength(FIRST_PACK);
    expect(h.calls.every((c) => c.length <= PASSAGES_PER_CALL)).toBe(true);
    expect(h.peak()).toBeGreaterThan(1);
    expect(h.peak()).toBeLessThanOrEqual(PACKS_IN_FLIGHT);
    expect(h.commits.flat().sort()).toEqual(h.chunks.map((c) => c.id).sort());
    expect(h.events.at(-1)).toContain("80 facts so far · 40 read, 0 skipped of 40");
  });

  it("commits each call as soon as it finishes, and a failed call still lets finished ones commit", async () => {
    // The first pack (ch0-ch2) is slow; later packs finish and commit before it.
    const h = harness(20, { delay: (ids) => (ids.includes("ch0") ? 60 : 5) });
    await seedBrainStage.run(h.ctx);
    expect(h.commits[0]).not.toContain("ch0");

    const f = harness(20, { delay: (ids) => (ids.includes("ch0") ? 40 : 5), fail: (ids) => ids.includes("ch0") });
    await expect(seedBrainStage.run(f.ctx)).rejects.toThrow("gateway 502");
    expect(f.commits.flat().length).toBe(20 - FIRST_PACK); // paid-for calls are never thrown away
    expect(f.pending()).toBe(FIRST_PACK); // the retry re-extracts only the failed pack
  });

  it("skips what triage skips and leaves low passages for the background on a scan's first pass", async () => {
    const h = harness(30, { scanId: "scan1", label: (i) => (i % 3 === 0 ? "skip" : i % 3 === 1 ? "low" : "high") });
    const r = await seedBrainStage.run(h.ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "seed_brain", detached: true }, { stage: "cascade" }] });
    expect(h.commits.flat().map((id) => Number(id.slice(2)) % 3)).toEqual(Array(10).fill(2));
    expect(h.pending()).toBe(10); // the low ones
    // A small first triage call (so extraction starts sooner), then the rest in one call.
    const triaged = h.events.flatMap((e) => [...e.matchAll(/Triaged (\d+) passages: (\d+) to learn now, (\d+) later, (\d+) skipped/g)].map((m) => m.slice(1).map(Number)));
    expect(triaged.map((t) => t[0])).toEqual([12, 18]);
    expect(triaged.reduce((a, t) => a.map((x, i) => x + t[i]), [0, 0, 0, 0])).toEqual([30, 10, 10, 10]);
  });

  it("a scan's first pass stops at the cap and continues the rest as a detached background job", async () => {
    const h = harness(FIRST_PASS_PASSAGES + 30, { scanId: "scan1" });
    const r = await seedBrainStage.run(h.ctx);
    expect(r).toMatchObject({ done: true, next: [{ stage: "seed_brain", detached: true }, { stage: "cascade" }] });
    expect(h.pending()).toBe(30);
  });
});
