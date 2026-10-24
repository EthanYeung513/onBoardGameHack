import { describe, expect, it } from "vitest";
import { instantiateGame } from "@/games/core/instantiate";
import { OfflineClient } from "@/llm/offline";
import type { ChatRequest, LlmClient } from "@/llm/types";
import { buildGameUserMessage, generateGameSpec, GenerateGameError, type GenerateGameInput } from "@/tasks/generate-game";
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

  it("defaults to battle when no game is requested", () => {
    const result = instantiateGame(offlineGenerateGame(input));
    expect(result.ok && result.game).toBe("battle");
  });
});

describe("generateGameSpec", () => {
  it("returns the validated game and spec through the llm client", async () => {
    const { game, spec, call } = await generateGameSpec(offline, "offline-baseline", input);
    expect(game).toBe("battle");
    expect((spec as { rounds: unknown[] }).rounds.length).toBeGreaterThanOrEqual(3);
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
    expect(game).toBe("battle");
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
