import { describe, expect, it } from "vitest";
import { stripEmDash, stripEmDashDeep } from "@/lib/emdash";
import { buildOnboardingContent } from "@/lib/onboarding/content";

describe("em-dash rule (Nicole): drop the em-dash and everything after it", () => {
  it("keeps only the text before the first em-dash", () => {
    expect(stripEmDash("Welcome — your journey starts")).toBe("Welcome");
    expect(stripEmDash("Welcome—your journey")).toBe("Welcome");
    expect(stripEmDash("A — b — c")).toBe("A");
    expect(stripEmDash("No dash here – en dash stays")).toBe("No dash here – en dash stays");
    // Never blank: a leading em-dash keeps what follows.
    expect(stripEmDash("— Tip: ship small")).toBe("Tip: ship small");
  });

  it("walks model output (objects and arrays), leaving non-strings alone", () => {
    const out = stripEmDashDeep({ title: "Day one — the basics", steps: [{ text: "Meet Priya — VP Eng", n: 2, ok: true }], ids: ["f1"] });
    expect(out).toEqual({ title: "Day one", steps: [{ text: "Meet Priya", n: 2, ok: true }], ids: ["f1"] });
  });
});

describe("em-dash rule at the write points", () => {
  it("the hire's world never shows one, even for facts generated before the rule", () => {
    const world = buildOnboardingContent({
      space: { name: "Acme", host: "acme.com", slug: "acme" },
      brand: null,
      courses: [],
      facts: [{ text: "Demo Day is every other Friday — anyone can show work", category: "Rituals" }],
      rejected: [],
      rewards: [{ name: "Coffee — $5", costCoins: 100 }],
    });
    expect(world.BRAIN_FACTS).toEqual([{ cat: "Rituals", text: "Demo Day is every other Friday" }]);
    expect(world.REWARDS[0].name).toBe("Coffee");
  });

  it("the worker's llm.json strips generated strings (offline stand-ins too)", async () => {
    const { vi } = await import("vitest");
    vi.stubEnv("MUBIT_API_KEY", "");
    const { createLlm } = await import("@/worker/providers/llm");
    const { z } = await import("zod");
    const r = await createLlm().json({ task: "t", system: "s", user: "u", schema: z.object({ title: z.string() }), offline: () => ({ title: "Welcome — your journey starts" }) });
    expect(r).toMatchObject({ mode: "offline", value: { title: "Welcome" } });
    vi.unstubAllEnvs();
  });
});
