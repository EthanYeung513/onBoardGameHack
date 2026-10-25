import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import { deployStage } from "@/worker/stages/deploy";
import type { StageContext } from "@/worker/types";

// The deploy stage never fakes a Vercel URL: no token or a refused token → labelled stand-in.

const input = {
  space: { name: "Acme Pay", host: "acmepay.example", slug: "acme-pay", mode: "live" as const },
  brand: null,
  courses: [{ packType: "company", title: "Company 101", icon: "landmark", building: "HQ Hall", game: "quiz", spec: { steps: [{ kind: "quiz", title: "Q?", options: [{ text: "A", correct: true }, { text: "B" }] }] } }],
  facts: [],
  rejected: [],
  rewards: [],
};

function ctx() {
  const recorded: Record<string, unknown>[] = [];
  const c = {
    space: { _id: "s1", slug: "acme-pay", name: "Acme Pay" },
    job: { attempt: 0 },
    event: vi.fn(async () => undefined),
    convex: {
      query: vi.fn(async () => input),
      mutation: vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
        if (getFunctionName(fn as never) === getFunctionName(api.deploy.recordDeploy)) recorded.push(args);
        return null;
      }),
    },
  } as unknown as StageContext;
  return { c, recorded };
}

describe("deploy stage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("publishes the stand-in when no Vercel token is set", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    vi.stubEnv("VERCEL_TOKEN_FULL", "");
    const { c, recorded } = ctx();
    await expect(deployStage.run(c)).resolves.toMatchObject({ done: true });
    expect(recorded).toEqual([{ spaceId: "s1", ok: true, mode: "stand-in", url: "/o/acme-pay" }]);
  });

  it("falls back to the stand-in when Vercel refuses the token (403), without retrying", async () => {
    vi.stubEnv("VERCEL_TOKEN", "read-only");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "You don't have permission to create a project." } }), { status: 403 })));
    const { c, recorded } = ctx();
    await expect(deployStage.run(c)).resolves.toMatchObject({ done: true, summary: expect.stringContaining("stand-in") });
    expect(recorded[0]).toMatchObject({ ok: true, mode: "stand-in", url: "/o/acme-pay" });
  });
});
