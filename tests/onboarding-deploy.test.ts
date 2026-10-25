import { describe, expect, it, vi } from "vitest";
import { buildBundle } from "@/lib/onboarding/bundle";
import { buildOnboardingContent, onboardingScript, type OnboardingInput } from "@/lib/onboarding/content";
import { deployStatic, projectNameFor, vercelConfigFromEnv } from "@/lib/onboarding/vercel";

const input = (over: Partial<OnboardingInput> = {}): OnboardingInput => ({
  space: { name: "Acme Pay", host: "acmepay.example", slug: "acme-pay", mode: "live" },
  brand: { primary: "#635bff", accent: "#00d4ff" },
  courses: [
    {
      packType: "company",
      title: "Company 101",
      icon: "landmark",
      building: "HQ Hall",
      game: "quiz",
      spec: {
        steps: [
          { id: "s1", kind: "welcome", title: "Welcome" },
          { id: "s2", kind: "lesson", title: "How we ship", body: "Deploys happen on Tuesdays." },
          { id: "s3", kind: "quiz", title: "When do we deploy?", options: [{ text: "Tuesdays", correct: true }, { text: "Fridays at 5pm" }] },
        ],
      },
    },
    { packType: "hard-conversations", title: "Hard Conversations", icon: "target", building: "Dojo", game: "scenario", spec: { steps: [] } },
  ],
  facts: [{ text: "Priya reviews architecture PRs", category: "People", entityName: "Priya", entityType: "person" }],
  rejected: [{ text: "Deploy on Fridays", category: "Rituals" }],
  rewards: [{ name: "Lunch on us", costCoins: 300 }],
  ...over,
});

describe("onboarding world content (D-33)", () => {
  it("maps real courses into the world's building slots and builds games only from real content", () => {
    const c = buildOnboardingContent(input());
    expect(c.COURSES.map((x) => [x.id, x.title])).toEqual([
      ["c1", "Company 101"],
      ["c4", "Hard Conversations"],
    ]);
    expect(c.QUIZ).toEqual([{ q: "When do we deploy?", a: ["Tuesdays", "Fridays at 5pm"], correct: 0 }]);
    expect(c.COURSES[1].game).toBe("quiz"); // no real scenario content → plays a game that has content
    expect(c.INBOX_CARDS.map((x) => x.save)).toEqual([true, false]); // rejected facts are "don't keep" cards
    expect(c.NPCS[0]).toMatchObject({ name: "Priya", fact: "Priya reviews architecture PRs" });
    expect(c.brand.primary).toBe("#635bff");
    expect(c.playable).toBe(true);
    expect(buildOnboardingContent(input({ courses: [] })).playable).toBe(false);
  });

  it("bundles the mockup world plus a generated onboarding.js that is safe to inline", () => {
    const content = buildOnboardingContent(input({ facts: [{ text: "</script><script>alert(1)</script>", category: "Other" }] }));
    const files = buildBundle(content, "vercel");
    expect(files.map((f) => f.file)).toEqual(["index.html", "styles.css", "state.js", "game.js", "onboarding.js"]);
    expect(files[0].data).toContain('<script src="onboarding.js"></script>');
    const js = onboardingScript(content, { generatedAt: "2026-10-25T00:00:00Z", mode: "stand-in" });
    expect(js).not.toContain("</script>");
    expect(js).toContain("Preview build (stand-in)");
  });
});

describe("Vercel create-or-update", () => {
  it("uses the token only when set and names one stable project per company", () => {
    expect(vercelConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(vercelConfigFromEnv({ VERCEL_TOKEN: "t", VERCEL_TOKEN_FULL: "full" } as unknown as NodeJS.ProcessEnv)?.token).toBe("full");
    expect(vercelConfigFromEnv({ VERCEL_TOKEN: "t", OFFLINE: "1" } as unknown as NodeJS.ProcessEnv)).toBeNull();
    expect(projectNameFor("Acme Pay!")).toBe("orthogonal-acme-pay-");
  });

  it("deploys to production, polls until READY and returns the production alias", async () => {
    const calls: { method: string; url: string; body?: unknown }[] = [];
    const replies = [
      { id: "dpl_1", url: "orthogonal-acme-pay-abc.vercel.app", readyState: "QUEUED", projectId: "prj_1" },
      { id: "dpl_1", url: "orthogonal-acme-pay-abc.vercel.app", readyState: "READY", projectId: "prj_1", alias: ["orthogonal-acme-pay.vercel.app"] },
    ];
    const fetchImpl = vi.fn(async (u: URL | string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url: String(u), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    });
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    const res = await deployStatic({ token: "t", teamId: "team_1" }, { projectName: "orthogonal-acme-pay", files: [{ file: "index.html", data: "<p>hi</p>" }] }, fetchImpl as typeof fetch);
    vi.useRealTimers();
    expect(res).toEqual({ url: "https://orthogonal-acme-pay.vercel.app", projectId: "prj_1", deploymentId: "dpl_1" });
    expect(calls[0]).toMatchObject({ method: "POST", body: { name: "orthogonal-acme-pay", project: "orthogonal-acme-pay", target: "production" } });
    expect(calls[0].url).toContain("teamId=team_1");
  });
});
