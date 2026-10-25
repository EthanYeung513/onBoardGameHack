// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import { cascadeStage } from "@/worker/stages/cascade";
import { seedBrainStage } from "@/worker/stages/seed-brain";
import { brainSetup, ingest, runStage, scriptedLlm, secret } from "./brain-helpers";

const filler = (word: string) => Array.from({ length: 40 }, (_, i) => `${word} paragraph sentence number ${i}.`).join(" ");

describe("cascade stage (F34/F35/F36)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("changed doc → facts stale → re-extracted facts restored, vanished ones stay stale for review", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "oncall.md", text: "# Oncall\n\n- The rota hands over on Monday\n- Pages are acknowledged within 5 minutes" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    await runStage(cascadeStage, { t, convex, spaceId, llm }); // settles the `added` event

    const v2 = await ingest(t, convex, spaceId, { externalId: "oncall.md", text: "# Oncall\n\n- The rota hands over on Monday\n- Pages are acknowledged within 10 minutes" });
    expect(v2).toMatchObject({ status: "changed", staleFacts: 2 });

    const { result, events } = await runStage(cascadeStage, { t, convex, spaceId, llm });
    expect(result).toMatchObject({ done: true });
    expect(events.join("\n")).toMatch(/1 facts refreshed, 1 need review/);

    const { facts, diffs, audits } = await t.run(async (ctx) => ({
      facts: await ctx.db.query("facts").collect(),
      diffs: await ctx.db.query("diff_events").collect(),
      audits: await ctx.db.query("audit_events").collect(),
    }));
    const byText = Object.fromEntries(facts.map((f) => [f.text, f]));
    expect(byText["The rota hands over on Monday"]).toMatchObject({ status: "approved", version: 3 });
    expect(byText["Pages are acknowledged within 5 minutes"]).toMatchObject({ status: "stale" });
    expect(byText["Pages are acknowledged within 10 minutes"]).toMatchObject({ status: "approved", version: 1 });
    expect(diffs.every((d) => d.processedAt)).toBe(true);
    const kinds = audits.map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["fact.stale", "fact.refreshed", "fact.still_stale", "cascade.event"]));
  });

  it("restores a fact whose cited passage is unchanged when another part of the doc changes", async () => {
    const { t, mgr, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    const text = (tail: string) => `# Intro\n\n${filler("alpha")}\n\n# Tail\n\n${filler(tail)}`;
    const v1 = await ingest(t, convex, spaceId, { externalId: "big.md", text: text("beta") });
    const chunk0 = await t.run(async (ctx) => (await ctx.db.query("doc_chunks").collect()).find((c) => c.idx === 0)!);
    expect(await t.run(async (ctx) => (await ctx.db.query("doc_chunks").collect()).length)).toBe(2);
    await mgr.mutation(api.facts.add, { spaceId, text: "Alpha paragraphs come first", category: "Docs & History", chunkIds: [chunk0._id] });
    await runStage(cascadeStage, { t, convex, spaceId, llm });

    expect(await ingest(t, convex, spaceId, { externalId: "big.md", text: text("gamma") })).toMatchObject({ status: "changed", staleFacts: 1, sourceItemId: v1.sourceItemId });
    await runStage(cascadeStage, { t, convex, spaceId, llm });
    const [fact] = await mgr.query(api.facts.list, { spaceId });
    expect(fact).toMatchObject({ status: "approved", createdBy: "manager" });
    expect(fact.citations).toHaveLength(2); // old + current version of the unchanged passage
    const refreshed = (await t.run((ctx) => ctx.db.query("audit_events").collect())).find((a) => a.kind === "fact.refreshed");
    expect(refreshed?.payload.reason).toMatch(/unchanged/);
  });

  it("is resumable: a slice that runs out of time continues from the cursor without repeating work", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm, users } = scriptedLlm();
    for (const n of [1, 2, 3]) await ingest(t, convex, spaceId, { externalId: `d${n}.md`, text: `# Doc ${n}\n\n- Fact number ${n} is true` });

    let calls = 0;
    const first = await runStage(cascadeStage, { t, convex, spaceId, llm, remaining: () => (++calls > 3 ? 0 : 60_000) });
    expect(first.result.done).toBe(false);
    const cursor = (first.result as unknown as { cursor: { processed: number; lastId: string } }).cursor;
    expect(cursor.processed).toBeGreaterThanOrEqual(1);
    expect(cursor.processed).toBeLessThan(3);

    const second = await runStage(cascadeStage, { t, convex, spaceId, llm, cursor });
    expect(second.result).toMatchObject({ done: true, summary: expect.stringMatching(/^3 changes applied/) });
    expect(users).toHaveLength(3); // each chunk extracted exactly once across both slices
    const { facts, settled } = await t.run(async (ctx) => ({
      facts: await ctx.db.query("facts").collect(),
      settled: (await ctx.db.query("audit_events").collect()).filter((a) => a.kind === "cascade.event"),
    }));
    expect(facts).toHaveLength(3);
    expect(settled).toHaveLength(3);
  });

  it("a Slack message change flows source → fact → course → step, exactly like a website page", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    const connectorId = await convex.mutation(api.ingest.ensureConnector, { spaceId, type: "slack" });
    const msg = await ingest(t, convex, spaceId, { externalId: "C123:1700000000", kind: "message", connectorId, text: "# #payments\n\n- Payout freeze starts at 16:00 on Fridays" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    await runStage(cascadeStage, { t, convex, spaceId, llm });
    const { courseId } = await t.run(async (ctx) => {
      const fact = (await ctx.db.query("facts").collect())[0];
      const courseId = await ctx.db.insert("courses", { spaceId, packType: "payments", title: "Payments 101", icon: "💳", building: "bank", game: "quiz", spec: {}, status: "published", needsRefresh: false, version: 1 });
      await ctx.db.insert("course_facts", { spaceId, courseId, factId: fact._id, stepId: "step-3" });
      return { courseId };
    });

    await ingest(t, convex, spaceId, { externalId: "C123:1700000000", kind: "message", connectorId, text: "# #payments\n\n- Payout freeze starts at 15:00 on Fridays" });
    const course = await t.run((ctx) => ctx.db.get(courseId));
    expect(course).toMatchObject({ needsRefresh: true, staleStepIds: ["step-3"] });
    const audits = await t.run((ctx) => ctx.db.query("audit_events").collect());
    const step = audits.find((a) => a.kind === "course.step_stale")!;
    expect(step.payload).toMatchObject({ source: { connectorType: "slack", kind: "message", title: "C123:1700000000" }, courseTitle: "Payments 101", stepId: "step-3" });
    expect(step.payload.chain).toMatch(/^slack “C123:1700000000” → fact “Payout freeze starts at 16:00 on Fridays” → course “Payments 101” → step step-3$/);
    expect(audits.find((a) => a.kind === "fact.stale")?.payload.source).toMatchObject({ connectorType: "slack", sourceItemId: msg.sourceItemId });

    const { events } = await runStage(cascadeStage, { t, convex, spaceId, llm });
    expect(events.join("\n")).toMatch(/^slack · Changed message: C123:1700000000: 0 facts refreshed, 1 need review$/m);
    const facts = await t.run((ctx) => ctx.db.query("facts").collect());
    expect(facts.map((f) => [f.text, f.status])).toEqual([
      ["Payout freeze starts at 16:00 on Fridays", "stale"],
      ["Payout freeze starts at 15:00 on Fridays", "approved"],
    ]);
  });
});
