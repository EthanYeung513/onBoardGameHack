import { readFileSync } from "node:fs";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import { factKey, hardKeys } from "@/lib/brain/normalize";
import { offlineExtract, OFFLINE_CONFIDENCE } from "@/lib/brain/offline";
import { ExtractionBatch } from "@/lib/brain/types";
import { BRAIN_EXTRACT_BATCH_SYSTEM_PROMPT, BRAIN_EXTRACT_SYSTEM_PROMPT, BRAIN_RESOLVE_SYSTEM_PROMPT } from "@/lib/prompts";
import { dedupeBatch, resolveEntities } from "@/worker/brain/resolve";
import type { Llm } from "@/worker/providers/llm";
import type { WorkerConvex } from "@/worker/types";

describe("brain prompts", () => {
  it("keeps the extraction and resolution system prompts byte-identical (one Mubit task each)", () => {
    expect(BRAIN_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot("brain_extract");
    expect(BRAIN_EXTRACT_BATCH_SYSTEM_PROMPT).toMatchSnapshot("brain_extract_batch");
    expect(BRAIN_RESOLVE_SYSTEM_PROMPT).toMatchSnapshot("brain_resolve");
  });
});

describe("normalisation", () => {
  it("derives hard keys strongest first and a punctuation-insensitive fact key", () => {
    expect(hardKeys({ name: "Dana Kim", aliases: ["@dana"], keys: { email: "Dana@Acme.com", login: "@DanaK", url: "https://www.github.com/danak/" } })).toEqual([
      "email:dana@acme.com",
      "login:danak",
      "url:github.com/danak",
      "name:dana kim",
      "name:@dana",
    ]);
    expect(factKey("Deploys happen on Tuesdays.")).toBe(factKey("  deploys HAPPEN on tuesdays "));
  });

  it("merges entities in one extraction that share a hard key", () => {
    const { entities, indexOf } = dedupeBatch([
      { type: "person", name: "Dana Kim", aliases: [], keys: { email: "dana@acme.com" } },
      { type: "person", name: "Dana", aliases: [], keys: { email: "DANA@acme.com" } },
      { type: "tool", name: "Vault", aliases: [], keys: {} },
    ]);
    expect(entities).toHaveLength(2);
    expect(entities[0].aliases).toEqual(["Dana"]);
    expect(indexOf("dana")).toBe(0);
    expect(indexOf("VAULT")).toBe(1);
  });
});

describe("offline extraction stand-in", () => {
  it("turns headings, owners and tool names into a valid, draft-confidence batch", () => {
    const text = readFileSync("content/acme-pay/company-handbook.md", "utf8").split("\n## ").find((s) => s.startsWith("Who owns what"))!;
    const batch = ExtractionBatch.parse(offlineExtract(`## ${text}`));
    expect(batch.entities).toEqual(expect.arrayContaining([expect.objectContaining({ type: "org_unit", name: "Customer Support" }), expect.objectContaining({ type: "term", name: "Who owns what" })]));
    expect(batch.facts.some((f) => f.category === "People" && f.entity_names.includes("Payments Engineering"))).toBe(true);
    expect(batch.facts.every((f) => f.confidence === OFFLINE_CONFIDENCE)).toBe(true);
    const tools = offlineExtract("## Tools we use\n\nSlack for chat, the Expenses app for claims. Engineering also uses GitHub.");
    expect(tools.entities.filter((e) => e.type === "tool").map((e) => e.name).sort()).toEqual(["Expenses app", "GitHub", "Slack"]);
  });
});

describe("entity resolution (F15)", () => {
  const space = { _id: "s1", name: "Acme" } as never;
  const cands = [
    { type: "person" as const, name: "Dana", aliases: [], keys: { email: "dana@acme.com" } },
    { type: "tool" as const, name: "Ledger API", aliases: [], keys: {} },
    { type: "term" as const, name: "Payout batch", aliases: [], keys: {} },
    { type: "tool" as const, name: "Figma", aliases: [], keys: {} },
  ];
  const scores: Record<string, number> = { "Ledger API": 0.97, "Payout batch": 0.85, Figma: 0.3 };

  function setup(same: boolean) {
    const action = vi.fn(async (_fn: unknown, args: { vector: number[] }) => {
      const name = cands[args.vector[0]].name;
      return [{ id: `e-${name}`, name: `${name} (existing)`, aliases: [], score: scores[name] }];
    });
    const query = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => [{ id: "e-dana", name: "Dana Kim", key: "email:dana@acme.com" }, null, null, null]);
    const convex = { query, mutation: vi.fn(), action } as unknown as WorkerConvex;
    const json = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({ value: { same, confidence: 0.9, reason: "same thing" }, mode: "live" as const, model: "gpt-x" }));
    const llm = { live: true, json } as unknown as Llm;
    const embed = { mode: "live" as const, embed: vi.fn(async (texts: string[]) => texts.map((_, i) => [i])) };
    return { ctx: { convex, llm, embed, space }, action, query, json };
  }

  it("resolves hard keys without vectors or the LLM, auto-matches near-identical vectors, adjudicates the ambiguous band, creates the rest", async () => {
    const { ctx, action, query, json } = setup(true);
    const out = await resolveEntities(ctx, cands, "context sentence");
    expect(getFunctionName(query.mock.calls[0][0] as never)).toBe(getFunctionName(api.brainWorker.matchHardKeys));
    expect(out.map((e) => [e.match, e.decision.method])).toEqual([
      ["e-dana", "hard_key"],
      ["e-Ledger API", "embedding"],
      ["e-Payout batch", "llm"],
      [undefined, "new"],
    ]);
    expect(action).toHaveBeenCalledTimes(3); // not for the hard-key hit
    expect(json).toHaveBeenCalledTimes(1);
    expect(json.mock.calls[0][0]).toMatchObject({ task: "brain_resolve", system: BRAIN_RESOLVE_SYSTEM_PROMPT });
    expect(out[2].decision).toMatchObject({ score: 0.85, reason: "same thing", mode: "live" });
  });

  it("keeps an ambiguous candidate separate when the adjudicator says different", async () => {
    const { ctx } = setup(false);
    const out = await resolveEntities(ctx, cands, "context");
    expect(out[2]).toMatchObject({ match: undefined, decision: { method: "llm", candidateId: "e-Payout batch" } });
  });
});
