// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import { seedBrainStage } from "@/worker/stages/seed-brain";
import { brainSetup, ingest, runStage, scriptedLlm, secret } from "./brain-helpers";

describe("seed_brain extraction + brain writes (S8)", () => {
  beforeEach(() => vi.stubEnv("WORKER_SECRET", secret));

  it("writes cited facts, applies the threshold, dedupes across chunks and resolves entities by hard key", async () => {
    const { t, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "a.md", text: "# Deploys\n\n- Deploys happen on Tuesdays {0.95}\n- Hotfixes need a lead's approval {0.5}\nowner: Dana Kim <Dana@Acme.com>" });
    await ingest(t, convex, spaceId, { externalId: "b.md", text: "# deploys\n\n- deploys happen on tuesdays. {0.97}\nowner: Dana <dana@acme.com>" });

    const { result } = await runStage(seedBrainStage, { t, convex, spaceId, llm });
    expect(result).toMatchObject({ done: true, next: [{ stage: "cascade" }] });

    const db = await t.run(async (ctx) => ({
      facts: await ctx.db.query("facts").collect(),
      citations: await ctx.db.query("fact_citations").collect(),
      entities: await ctx.db.query("entities").collect(),
      chunks: await ctx.db.query("doc_chunks").collect(),
      audits: await ctx.db.query("audit_events").collect(),
    }));
    const tuesday = db.facts.find((f) => /tuesdays/i.test(f.text))!;
    const hotfix = db.facts.find((f) => /hotfix/i.test(f.text))!;
    expect(db.facts).toHaveLength(2); // the second "deploys happen on tuesdays." is the same fact
    expect(tuesday).toMatchObject({ status: "approved", createdBy: "agent" });
    expect(tuesday.sourceChunkIds).toHaveLength(2);
    expect(db.citations.filter((c) => c.factId === tuesday._id)).toHaveLength(2);
    expect(hotfix).toMatchObject({ status: "draft", confidence: 0.5 });
    expect(db.facts.every((f) => f.sourceChunkIds.length >= 1 && db.citations.some((c) => c.factId === f._id))).toBe(true);

    // "Deploys"/"deploys" share a name key; Dana Kim/Dana share an email key → one entity each.
    expect(db.entities.map((e) => `${e.type}:${e.name}`).sort()).toEqual(["person:Dana Kim", "term:Deploys"]);
    expect(db.entities.find((e) => e.type === "person")).toMatchObject({ key: "email:dana@acme.com", aliases: ["Dana"], version: 2 });
    const resolved = db.audits.filter((a) => a.kind === "entity.resolved").map((a) => a.payload);
    expect(resolved.filter((p) => p.decision === "matched").every((p) => p.method === "hard_key")).toBe(true);
    expect(resolved).toHaveLength(4);
    expect(db.chunks.every((c) => c.extractedAt)).toBe(true);
  });

  it("never resurfaces a rejected fact and feeds it back as a negative example; review writes need the current version", async () => {
    const { t, mgr, spaceId, convex } = await brainSetup(0.9);
    const { llm, users } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "a.md", text: "# Pay\n\n- Payday is the 25th {0.6}" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    const [fact] = await mgr.query(api.facts.list, { spaceId, status: "draft" });
    expect(fact.citations[0].snippet).toContain("Payday");

    await mgr.mutation(api.facts.reject, { factId: fact.id, version: fact.version });
    await expect(mgr.mutation(api.facts.approve, { factId: fact.id, version: fact.version })).rejects.toThrow(/changed since/);

    await ingest(t, convex, spaceId, { externalId: "b.md", text: "# Payroll\n\n- payday is the 25th! {0.99}" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    expect(users.at(-1)).toContain("Rejected facts (never re-propose");
    expect(users.at(-1)).toContain("Payday is the 25th");
    const facts = await t.run((ctx) => ctx.db.query("facts").collect());
    expect(facts.map((f) => f.status)).toEqual(["rejected"]);
    const kinds = (await t.run((ctx) => ctx.db.query("audit_events").collect())).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["fact.rejected", "fact.suppressed"]));
  });

  it("edit keeps provenance; manual facts must cite a chunk or carry a note; other users get 403", async () => {
    const { t, mgr, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "a.md", text: "# Lunch\n\n- Lunch is at noon {0.5}" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    const [fact] = await mgr.query(api.facts.list, { spaceId });
    const r = await mgr.mutation(api.facts.edit, { factId: fact.id, version: fact.version, text: "Lunch is at 12:30" });
    const [edited] = await mgr.query(api.facts.list, { spaceId });
    expect(edited).toMatchObject({ text: "Lunch is at 12:30", status: "approved", version: r.version });
    expect(edited.citations).toEqual(fact.citations);

    // Re-extracting the original sentence is recognised as the edited fact, not a new draft.
    await ingest(t, convex, spaceId, { externalId: "b.md", text: "# Lunch\n\n- Lunch is at noon {0.5}" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    expect(await mgr.query(api.facts.list, { spaceId })).toHaveLength(1);

    await expect(mgr.mutation(api.facts.add, { spaceId, text: "The CEO is Jo", category: "People" })).rejects.toThrow(/Cite at least one source/);
    const chunkId = fact.citations[0].chunkId;
    await mgr.mutation(api.facts.add, { spaceId, text: "Lunch is paid on Fridays", category: "Policy", chunkIds: [chunkId] });
    const { factId } = await mgr.mutation(api.facts.add, { spaceId, text: "The CEO is Jo", category: "People", note: "Said at the all-hands" });
    const cited = await t.run(async (ctx) => {
      const [c] = await ctx.db.query("fact_citations").withIndex("by_fact", (q) => q.eq("factId", factId)).collect();
      return (await ctx.db.get(c.sourceItemId))!;
    });
    expect(cited.title).toBe("Manager note");

    const otherId = await t.run((ctx) => ctx.db.insert("users", { email: "eve@evil.com" }));
    const eve = t.withIdentity({ subject: `${otherId}|s` });
    await expect(eve.query(api.facts.list, { spaceId })).rejects.toThrow(/access/);
    await expect(eve.mutation(api.facts.reject, { factId, version: 1 })).rejects.toThrow(/access/);
  });

  it("searches chunks + facts with citations and expands one hop over edges", async () => {
    const { t, mgr, spaceId, convex } = await brainSetup(0.9);
    const { llm } = scriptedLlm();
    await ingest(t, convex, spaceId, { externalId: "ledger.md", text: "# Ledger\n\n- The Ledger records every balance movement {0.95}\nowner: Sam Lee <sam@acme.com>" });
    await runStage(seedBrainStage, { t, convex, spaceId, llm });
    const [ledger, sam] = await t.run(async (ctx) => {
      const all = await ctx.db.query("entities").collect();
      return [all.find((e) => e.name === "Ledger")!, all.find((e) => e.name === "Sam Lee")!];
    });
    await t.run((ctx) => ctx.db.insert("edges", { spaceId, sourceId: sam._id, targetId: ledger._id, relation: "owns", version: 1 }));
    // Sam is not mentioned in the matching chunk's facts' entity, but is one hop away from Ledger.
    await t.run(async (ctx) => {
      for (const m of await ctx.db.query("entity_mentions").collect()) if (m.entityId === sam._id) await ctx.db.delete(m._id);
    });
    const res = await mgr.action(api.search.search, { spaceId, q: "balance movement" });
    expect(res.modes).toEqual({ lexical: true, vector: false, graph: true });
    expect(res.results[0].source.title).toBe("ledger.md");
    expect(res.facts[0]).toMatchObject({ text: "The Ledger records every balance movement" });
    expect(res.facts[0].citations[0].title).toBe("ledger.md");
    expect(res.entities).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Sam Lee", hop: 1, via: expect.objectContaining({ relation: "owns" }) })]));
  });
});
