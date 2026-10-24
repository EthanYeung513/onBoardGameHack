import { afterEach, describe, expect, it } from "vitest";
import { env, gatewayEnabled, resetEnvCache } from "@/lib/env";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  resetEnvCache();
});

describe("env", () => {
  it("accepts the alternate variable names used by the hosting environment", () => {
    process.env.MUBIT_API_KEY = "";
    process.env.MUBIT_API_TOKEN = "mbt_x";
    process.env.CLOUDFLARE_WEB_CRAWLER_API = "cf_x";
    process.env.VERCEL_API_KEY = "vck_x";
    resetEnvCache();
    const e = env();
    expect(e.MUBIT_API_KEY).toBe("mbt_x");
    expect(e.CLOUDFLARE_API_TOKEN).toBe("cf_x");
    expect(e.VERCEL_TOKEN).toBe("vck_x");
    expect(e.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    expect(gatewayEnabled(e)).toBe(true);
  });

  it("respects MUBIT_GATEWAY_ENABLED=false", () => {
    process.env.MUBIT_API_KEY = "mbt_x";
    process.env.MUBIT_GATEWAY_ENABLED = "false";
    resetEnvCache();
    expect(gatewayEnabled()).toBe(false);
  });

  it("rejects an unknown effort level with a readable error", () => {
    process.env.ANTHROPIC_EFFORT = "extreme";
    resetEnvCache();
    expect(() => env()).toThrow(/ANTHROPIC_EFFORT/);
  });
});
