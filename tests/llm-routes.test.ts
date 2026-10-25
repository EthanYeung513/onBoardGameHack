import { afterEach, describe, expect, it, vi } from "vitest";

// Nicole: "lets use the gateway for now". Every call lands in the Mubit project; direct Anthropic is
// an explicit emergency switch, never an automatic fallback.
async function routesWith(vars: Record<string, string>) {
  vi.resetModules();
  for (const k of ["MUBIT_API_KEY", "ANTHROPIC_API_KEY", "MUBIT_GATEWAY_ENABLED", "OFFLINE"]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  const { routes } = await import("@/lib/llm/client");
  return routes;
}

describe("LLM routing: the Mubit gateway only", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("with a Mubit key, the gateway is the only route, even when an Anthropic key is set", async () => {
    expect((await routesWith({ MUBIT_API_KEY: "mk", ANTHROPIC_API_KEY: "ak" }))()).toEqual(["gateway"]);
  });

  it("direct Anthropic only when the gateway is switched off on purpose", async () => {
    expect((await routesWith({ MUBIT_API_KEY: "mk", ANTHROPIC_API_KEY: "ak", MUBIT_GATEWAY_ENABLED: "false" }))()).toEqual(["direct"]);
  });

  it("an Anthropic key alone is not a route", async () => {
    const routes = await routesWith({ ANTHROPIC_API_KEY: "ak" });
    expect(() => routes()).toThrow(/MUBIT_API_KEY/);
  });
});
