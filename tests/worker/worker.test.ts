import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getFunctionName } from "convex/server";
import { api } from "@convex/_generated/api";
import { chunkText, contentHash } from "@/worker/chunk";
import { createEmbedder, hashedEmbedding } from "@/worker/providers/embed";
import { createLlm, ProviderOffline } from "@/worker/providers/llm";
import { runSlice, type Claimed } from "@/worker/runner";
import type { StageDefinition, WorkerConvex } from "@/worker/types";

describe("chunkText", () => {
  it("splits on headings and size, keeps order and never loses text", () => {
    const body = ["# Intro", "a ".repeat(900), "## Deploys", "We deploy on Tuesdays.", "## Oncall", "b ".repeat(3000)].join("\n\n");
    const chunks = chunkText(body, 500);
    expect(chunks.map((c) => c.idx)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.text.length <= 2000)).toBe(true);
    expect(chunks.some((c) => c.text.startsWith("## Deploys"))).toBe(true);
    expect(chunks.map((c) => c.text).join(" ").replace(/\s+/g, "")).toBe(body.replace(/\s+/g, ""));
    expect(chunkText("   ")).toEqual([]);
  });

  it("hashes content whitespace-insensitively", () => {
    expect(contentHash("a  b\n c")).toBe(contentHash("a b c"));
    expect(contentHash("a b")).not.toBe(contentHash("a c"));
  });
});

describe("providers", () => {
  const schema = z.object({ answer: z.number() });

  it("feeds validation errors back to the model and returns the corrected JSON", async () => {
    vi.stubEnv("MUBIT_API_KEY", "test-key");
    const reply = (content: string) => ({ withResponse: async () => ({ data: { model: "gpt-x", choices: [{ message: { content } }] }, response: new Response(null, { headers: { "x-mubit-request-id": "req-1" } }) }) });
    const create = vi.fn().mockReturnValueOnce(reply('{"answer":"four"}')).mockReturnValueOnce(reply('{"answer":4}'));
    const llm = createLlm({ chat: { completions: { create } } } as never);
    const r = await llm.json({ task: "t", system: "s", user: "u", schema });
    vi.unstubAllEnvs();
    expect(r).toEqual({ value: { answer: 4 }, mode: "live", model: "gpt-x", requestId: "req-1" });
    expect(create.mock.calls[0][1].headers).toEqual({ "X-Mubit-Task": "t" });
    expect(create.mock.calls[1][0].messages.at(-1).content).toMatch(/answer: .*number/i);
  });

  it("uses the labelled stand-in offline, or refuses (503) when there is none", async () => {
    vi.stubEnv("MUBIT_API_KEY", "");
    const llm = createLlm();
    expect(await llm.json({ task: "t", system: "s", user: "u", schema, offline: () => ({ answer: 1 }) })).toMatchObject({ mode: "offline" });
    await expect(llm.json({ task: "t", system: "s", user: "u", schema })).rejects.toBeInstanceOf(ProviderOffline);
    const e = createEmbedder();
    expect(e.mode).toBe("offline");
    const [v] = await e.embed(["deploys on tuesday"]);
    expect(v).toHaveLength(1536);
    expect(v).toEqual(hashedEmbedding("deploys on tuesday"));
    vi.unstubAllEnvs();
  });
});

describe("runSlice", () => {
  const claimed = {
    job: { _id: "j1", stage: "ready", progress: 0, cursor: {} },
    space: { _id: "s1", name: "Acme" },
    scan: null,
    connector: null,
  } as unknown as Claimed;

  function fakeConvex() {
    const calls: { fn: unknown; args: Record<string, unknown> }[] = [];
    const convex: WorkerConvex = {
      query: vi.fn() as never,
      mutation: (async (fn: unknown, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return { lost: false };
      }) as never,
    };
    return { convex, calls };
  }
  const deps = (convex: WorkerConvex, def: StageDefinition) => ({
    convex,
    workerId: "w",
    llm: createLlm({ chat: { completions: { create: vi.fn() } } } as never),
    embed: createEmbedder(),
    registry: { ready: def },
  });

  it("reports done with the stage's next jobs", async () => {
    const { convex, calls } = fakeConvex();
    const def: StageDefinition = { name: "ready", run: async () => ({ done: true, summary: "ok", next: [{ stage: "cascade" }] }) };
    expect(await runSlice(claimed, deps(convex, def))).toBe("done");
    const finish = calls.find((c) => getFunctionName(c.fn as never) === getFunctionName(api.pipeline.finish))!;
    expect(finish.args.outcome).toEqual({ kind: "done", summary: "ok", next: [{ stage: "cascade" }] });
  });

  it("turns a thrown error into a retryable failure, and a 503 provider error into a single attempt", async () => {
    const { convex, calls } = fakeConvex();
    const boom: StageDefinition = { name: "ready", maxAttempts: 3, run: async () => { throw new Error("socket hang up"); } };
    expect(await runSlice(claimed, deps(convex, boom))).toBe("error");
    expect(calls.at(-1)!.args.outcome).toEqual({ kind: "error", message: "socket hang up", maxAttempts: 3 });
    const offline: StageDefinition = { name: "ready", run: async () => { throw new ProviderOffline("LLM"); } };
    await runSlice(claimed, deps(convex, offline));
    expect((calls.at(-1)!.args.outcome as { maxAttempts: number }).maxAttempts).toBe(1);
  });
});
