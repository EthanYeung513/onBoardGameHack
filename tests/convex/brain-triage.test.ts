// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedBrainStage } from "@/worker/stages/seed-brain";
import { brainSetup, ingest, runStage, scriptedLlm, secret } from "./brain-helpers";

// Brain triage (`brain_classify`) before extraction: skip is recorded, never extracted; high is
// learned first; low waits for the background job on a scan's first pass.

describe("seed_brain triage", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("skips navigation with an audit row, extracts high now and low only after the first pass", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm, users } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "nav.md", text: "# Menu [skip]\n\n- Home and pricing and blog {0.95}" });
    await ingest(t, convex, spaceId, { externalId: "deploys.md", text: "# Deploys\n\n- Deploys happen on Tuesdays {0.95}" });
    await ingest(t, convex, spaceId, { externalId: "slogan.md", text: "# Vision [low]\n\n- We love great software {0.95}" });
    const scanId = await t.run((ctx) => ctx.db.insert("scans", { spaceId, url: "https://acme.com", status: "running", progress: 0, pageCount: 0 }));

    const first = await runStage(seedBrainStage, { t, convex, spaceId, llm, scanId });
    expect(first.result).toMatchObject({ done: true, next: [{ stage: "seed_brain", detached: true }, { stage: "cascade" }] });
    expect(first.events.some((e) => /Triaged 3 passages: 1 to learn now, 1 later, 1 skipped \(navigation 1\)/.test(e))).toBe(true);
    const read = async () =>
      t.run(async (ctx) => ({
        facts: (await ctx.db.query("facts").collect()).map((f) => f.text).sort(),
        chunks: await ctx.db.query("doc_chunks").collect(),
        skipped: (await ctx.db.query("audit_events").collect()).filter((a) => a.kind === "brain.skipped").map((a) => a.payload),
      }));
    let db = await read();
    expect(db.facts).toEqual(["Deploys happen on Tuesdays"]);
    expect(db.skipped).toEqual([expect.objectContaining({ label: "skip", reason: "navigation", mode: "live", source: expect.anything() })]);
    const byLabel = (l: string) => db.chunks.filter((c) => c.brainLabel === l);
    expect(byLabel("skip").every((c) => c.extractedAt)).toBe(true);
    expect(byLabel("low").every((c) => !c.extractedAt)).toBe(true);
    // The skipped passage never reached extraction.
    expect(users.filter((u) => u.includes("Passage id")).join("\n")).not.toContain("Home and pricing");

    // The detached background job (no scan) learns the low passage without classifying again.
    const calls = users.length;
    const bg = await runStage(seedBrainStage, { t, convex, spaceId, llm });
    expect(bg.result).toMatchObject({ done: true, next: [{ stage: "cascade" }] });
    expect(users.slice(calls).every((u) => !u.includes("### id: c"))).toBe(true);
    db = await read();
    expect(db.facts).toEqual(["Deploys happen on Tuesdays", "We love great software"]);
    expect(db.chunks.every((c) => c.extractedAt)).toBe(true);
    expect(db.skipped).toHaveLength(1);
  });

  it("labels repeated passages as duplicates without asking the model", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm, users } = scriptedLlm();
    const text = "# Footer\n\n- Support answers within a day {0.95}";
    await ingest(t, convex, spaceId, { externalId: "a.md", text });
    await ingest(t, convex, spaceId, { externalId: "b.md", text });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    const classify = users.filter((u) => u.includes("### id: c"));
    expect(classify).toHaveLength(1);
    expect(classify[0].match(/### id:/g)).toHaveLength(1);
    const audits = await t.run(async (ctx) => (await ctx.db.query("audit_events").collect()).filter((a) => a.kind === "brain.skipped"));
    expect(audits.map((a) => (a.payload as { reason: string }).reason)).toEqual(["duplicate of another passage"]);
    const chunks = await t.run((ctx) => ctx.db.query("doc_chunks").collect());
    expect(chunks.every((c) => c.extractedAt)).toBe(true);
  });
});
