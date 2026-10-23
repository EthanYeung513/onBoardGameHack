import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { MubitClient } from "@/llm/mubit";
import { TASKS } from "@/tasks/registry";

describe("task registry", () => {
  it("keeps system prompts byte-identical (changing one creates a new Mubit task)", () => {
    for (const task of Object.values(TASKS)) {
      expect({ version: task.version, system: task.system }).toMatchSnapshot(task.name);
    }
  });
});

describe("MubitClient", () => {
  it("sends the fixed system prompt, tags the task and records usage, cost and request id", async () => {
    const create = vi.fn().mockReturnValue({
      withResponse: async () => ({
        data: { id: "cmpl-1", model: "gpt-x", choices: [{ message: { content: "{\"ok\":true}" } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } },
        response: new Response(null, { headers: { "x-request-id": "req-42" } }),
      }),
    });
    const fake = { chat: { completions: { create } } } as unknown as OpenAI;
    const client = new MubitClient(
      { apiKey: "k", baseURL: "https://example.test/v1", taskHeader: "X-Mubit-Task", embedModel: null, pricePerMInput: 2, pricePerMOutput: 8 },
      fake,
    );

    const result = await client.chat({ task: "grade", model: "gpt-x", system: TASKS.grade.system, user: "answer", meta: {} });

    const [body, options] = create.mock.calls[0];
    expect(body.messages[0]).toEqual({ role: "system", content: TASKS.grade.system });
    expect(body.messages[1]).toEqual({ role: "user", content: "answer" });
    expect(options.headers).toEqual({ "X-Mubit-Task": "grade" });
    expect(result.requestId).toBe("req-42");
    expect(result.costUsd).toBeCloseTo((1000 * 2 + 500 * 8) / 1_000_000);
    expect(result.content).toBe("{\"ok\":true}");
  });
});
