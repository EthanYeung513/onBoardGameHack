import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MUBIT_MODEL } from "@/llm/mubit";
import { mubitConfigFromEnv } from "@/llm/env";
import { resetEnvCache } from "@/lib/env";
import { anthropicClient, routes } from "@/lib/llm/client";

// Judges inspect the adapters: every LLM + embedding call goes through src/llm/mubit.ts, gpt-*
// only, and no Mubit key is ever sent to an Anthropic path.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "_generated" || f === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mjs)$/.test(f) ? [p] : [];
  });
}

const source = ["src", "convex", "scripts"].flatMap(files).map((p) => ({ p, text: readFileSync(p, "utf8") }));

describe("Mubit integrity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("only src/llm/mubit.ts talks to the OpenAI-compatible gateway", () => {
    const offenders = source.filter(({ p, text }) => p !== join("src", "llm", "mubit.ts") && /new OpenAI\(|\.chat\.completions\b|\.embeddings\.create\b/.test(text));
    expect(offenders.map((o) => o.p)).toEqual([]);
  });

  it("never points a Mubit key at an /anthropic path, and Anthropic SDKs live only in the legacy direct fallback", () => {
    expect(source.filter(({ text }) => /MUBIT[A-Z_]*[^\n]*\/anthropic/.test(text)).map((o) => o.p)).toEqual([]);
    const anthropic = source.filter(({ text }) => /from "@anthropic-ai\/sdk"|@ai-sdk\/anthropic/.test(text)).map((o) => o.p);
    expect(anthropic.every((p) => p === join("src", "lib", "llm", "client.ts") || p.startsWith(join("src", "lib", "pipeline")) || p.startsWith(join("src", "lib", "status")))).toBe(true);
  });

  it("defaults to a gpt-* model and routes Mubit-only setups through the gateway", () => {
    expect(DEFAULT_MUBIT_MODEL).toMatch(/^gpt-/);
    vi.stubEnv("MUBIT_API_KEY", "k");
    vi.stubEnv("MUBIT_MODEL", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OFFLINE", "");
    resetEnvCache();
    expect(mubitConfigFromEnv()?.model).toMatch(/^gpt-/);
    expect(routes()).toEqual(["gateway"]);
    expect(() => anthropicClient("gateway")).toThrow(/gpt-\* models only/);
    vi.stubEnv("OFFLINE", "1");
    expect(mubitConfigFromEnv()).toBeNull();
  });
});
