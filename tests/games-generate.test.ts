import { describe, expect, it } from "vitest";
import { withoutSourceTail } from "@/games/core/GameResults";
import { instantiateGame } from "@/games/core/instantiate";
import { OfflineClient } from "@/llm/offline";
import type { ChatRequest, LlmClient } from "@/llm/types";
import { buildGameUserMessage, generateGameSpec, GenerateGameError, type GenerateGameInput } from "@/tasks/generate-game";
import { battleThemeFor } from "@/tasks/offline-battle-theme";
import { offlineGenerateGame } from "@/tasks/offline-generate-game";

const input: GenerateGameInput = {
  packTitle: "Security basics",
  role: "Engineer",
  playerName: "New Joiner",
  sections: [
    {
      doc: "Information Security Policy v4.0",
      heading: "4. Phishing",
      text: "- Report suspicious email with the Report phish button.\n- Never enter your password after clicking an emailed link.\n- If you clicked, report within 15 minutes.",
    },
    {
      doc: "Information Security Policy v4.0",
      heading: "2. Accounts and passwords",
      text: "- Use a hardware key or an authenticator app for MFA.\n- Never share your account or MFA codes with anyone, including IT.\n- SMS codes are not allowed.",
    },
    {
      doc: "Employee Handbook v3.2",
      heading: "5. Gifts and conflicts",
      text: "- Decline gifts over £50 from suppliers.\n- Log every accepted gift in the register.\n- Tell your manager about any conflict of interest.",
    },
  ],
};

const offline = new OfflineClient({ "generate-game": offlineGenerateGame });

describe("buildGameUserMessage", () => {
  it("includes the course sections and the game catalog", () => {
    const user = buildGameUserMessage(input);
    expect(user).toContain("Security basics");
    expect(user).toContain("4. Phishing");
    expect(user).toContain('"bestFor"');
    expect(user).toContain("word-match");
  });
});

describe("offlineGenerateGame", () => {
  it.each(["word-match", "dilemma", "battle"] as const)("produces a valid %s spec from course sections", (game) => {
    const result = instantiateGame(offlineGenerateGame({ ...input, game }));
    expect(result.ok && result.game).toBe(game);
  });

  it.each(["word-match", "dilemma", "battle"] as const)("fits long prose into %s without cutting it off", (game) => {
    const prose = {
      doc: "Company handbook",
      heading: "Who we are",
      text: "Acme Pay moves money for 40,000 small businesses across the UK and EU. We take card payments for merchants and pay\nthe money out to their bank accounts every working day. About 200 people work here across Customer Support,\nOperations, Engineering, Sales and Compliance. Slack for chat, Google Workspace for documents and email, Vault for customer data, the Expenses app for claims, and the People app for holidays.",
    };
    const long = { ...input, game, sections: [prose, { ...prose, heading: "Tools we use" }, ...input.sections] };
    const { spec } = offlineGenerateGame(long);
    const result = instantiateGame({ game, spec });
    expect(result.ok).toBe(true);
    const text = JSON.stringify(spec);
    expect(text).not.toContain("…");
    expect(text).not.toContain("\\n");
  });

  it("themes the battle's opponent and arena on the course", () => {
    const course = (packTitle: string, heading: string, text: string): GenerateGameInput => ({
      packTitle,
      role: null,
      sections: [{ doc: "Doc", heading, text }],
    });
    const security = battleThemeFor(input);
    const payments = battleThemeFor(course("Payments Engineering", "1. Ledger", "- Every payout is written to the ledger once."));
    const company = battleThemeFor(course("Company basics", "1. Holidays", "- Book holidays in the People app."));
    expect([security.arena, payments.arena, company.arena]).toEqual(["haunted", "city", "meadow"]);
    expect(new Set([security, payments, company].map((t) => t.opponent.pokemon)).size).toBe(3);
    // Same course, same opponent; a course matching no theme still gets one.
    expect(battleThemeFor(input)).toEqual(security);
    const other = battleThemeFor(course("Zzz", "Qqq", "- Xyz."));
    for (const t of [security, payments, company, other]) {
      expect(t.opponent.pokemon).toBeGreaterThanOrEqual(1);
      expect(t.opponent.pokemon).toBeLessThanOrEqual(251);
      expect(t.opponent.name.length).toBeLessThanOrEqual(16);
    }
    const spec = offlineGenerateGame({ ...input, game: "battle" }).spec as { arena: string; opponent: { name: string } };
    expect(spec.arena).toBe("haunted");
    expect(spec.opponent.name).toBe(security.opponent.name);
  });

  it("keeps the battle's source out of its explanations", () => {
    const { spec } = offlineGenerateGame({ ...input, game: "battle" });
    for (const r of (spec as { rounds: { explanation: string }[] }).rounds) expect(r.explanation).not.toContain("Source:");
  });

  it("picks names, not sentence openers, as word-match terms", () => {
    const prose = {
      doc: "Company handbook",
      heading: "Holidays and absence",
      text: "When you want time off, ask your manager first. Everyone Book holidays in the People app at least two weeks ahead. Use Google Workspace for documents. Customer Support works weekends on a rota.",
    };
    const { spec } = offlineGenerateGame({ ...input, game: "word-match", sections: [prose, ...input.sections] });
    expect(instantiateGame({ game: "word-match", spec }).ok).toBe(true);
    const terms = (spec as { pairs: { term: string }[] }).pairs.map((p) => p.term);
    for (const weak of ["When", "Everyone", "Everyone Book People", "Use"]) expect(terms).not.toContain(weak);
    expect(terms).toEqual(expect.arrayContaining(["Holidays and absence", "Phishing"]));
  });

  it("picks the game style from the course content when none is requested", () => {
    const pick = (packTitle: string, heading: string, text: string) =>
      offlineGenerateGame({ packTitle, role: null, sections: [{ doc: "Doc", heading, text }] }).game;
    // Security/compliance content → the courtroom; a neutral course → battle; vocab → word-match.
    expect(offlineGenerateGame(input).game).toBe("dilemma");
    expect(pick("Gardening club intro", "1. Watering", "- Rinse the secateurs after pruning.")).toBe("battle");
    expect(pick("Payments glossary", "1. Ledger terms", "- A payout moves money to a bank account.")).toBe(
      "word-match",
    );
  });
});

describe("generateGameSpec", () => {
  it("returns the validated game and spec through the llm client", async () => {
    const { game, spec, call } = await generateGameSpec(offline, "offline-baseline", input);
    expect(game).toBe("dilemma");
    expect(spec).toBeTruthy();
    expect(call.model).toBe("offline-baseline");
  });

  it("honours a requested game", async () => {
    const { game } = await generateGameSpec(offline, "offline-baseline", { ...input, game: "dilemma" });
    expect(game).toBe("dilemma");
  });

  it("retries once with the validation errors, then succeeds", async () => {
    let calls = 0;
    const flaky: LlmClient = {
      mode: "mubit",
      embed: async () => [],
      chat: async (req: ChatRequest) => {
        calls += 1;
        const content = calls === 1 ? "{not json" : JSON.stringify(offlineGenerateGame(req.meta));
        return { content, model: "m", requestId: null, latencyMs: 0, usage: { input: 0, output: 0 }, costUsd: 0 };
      },
    };
    const { game } = await generateGameSpec(flaky, "m", input);
    expect(calls).toBe(2);
    expect(game).toBe("dilemma");
  });

  it("throws GenerateGameError after a second invalid reply", async () => {
    const broken: LlmClient = {
      mode: "mubit",
      embed: async () => [],
      chat: async () => ({ content: "[]", model: "m", requestId: null, latencyMs: 0, usage: { input: 0, output: 0 }, costUsd: 0 }),
    };
    await expect(generateGameSpec(broken, "m", input)).rejects.toThrow(GenerateGameError);
  });
});

describe("withoutSourceTail", () => {
  it("drops a trailing source citation and leaves other explanations alone", () => {
    expect(withoutSourceTail("Decline gifts over £50. Source: Employee Handbook v3.2.")).toBe("Decline gifts over £50.");
    expect(withoutSourceTail("Report it within 15 minutes (Source: Security Policy, 4. Phishing)")).toBe("Report it within 15 minutes");
    expect(withoutSourceTail("Use the Report phish button.")).toBe("Use the Report phish button.");
  });
});
