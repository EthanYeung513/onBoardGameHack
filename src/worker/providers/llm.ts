import OpenAI from "openai";
import type { z } from "zod";
import { providerEnv } from "./env";

// Every LLM call in the pipeline: Mubit's OpenAI-compatible gateway, JSON mode, Zod-validated.
// Validation failures go back to the model with the error (bounded retries), never to the UI.
// With no key, `json()` uses the caller's labelled offline stand-in — or throws ProviderOffline.

export class ProviderOffline extends Error {
  readonly code = 503;
  constructor(what: string) {
    super(`${what} is not configured (set MUBIT_API_KEY) — no offline stand-in for this step`);
  }
}

export interface JsonRequest<T> {
  /** Task name, sent as the Mubit task header (one per fixed system prompt). */
  task: string;
  /** Fixed system prompt string from code (AGENTS.md "Model boundaries"). */
  system: string;
  /** Everything that varies goes here. */
  user: string;
  schema: z.ZodType<T>;
  /** Deterministic stand-in used when the provider is unconfigured; results must be labelled offline. */
  offline?: () => T;
  model?: string;
  retries?: number;
}

export interface JsonResult<T> {
  value: T;
  mode: "live" | "offline";
  model: string;
}

export interface Llm {
  readonly live: boolean;
  json<T>(req: JsonRequest<T>): Promise<JsonResult<T>>;
}

export function createLlm(client?: Pick<OpenAI, "chat">): Llm {
  const env = providerEnv();
  const openai = client ?? (env.live ? new OpenAI({ apiKey: env.mubitKey, baseURL: env.baseURL, maxRetries: 2 }) : null);
  return {
    live: Boolean(openai),
    async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
      if (!openai) {
        if (!req.offline) throw new ProviderOffline("The LLM provider");
        return { value: req.schema.parse(req.offline()), mode: "offline", model: "offline-stand-in" };
      }
      const model = req.model ?? env.model;
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ];
      const attempts = (req.retries ?? 2) + 1;
      let lastError = "";
      for (let i = 0; i < attempts; i++) {
        const res = await openai.chat.completions.create(
          { model, messages, response_format: { type: "json_object" } },
          { headers: { [env.taskHeader]: req.task } },
        );
        const content = res.choices[0]?.message?.content ?? "";
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch {
          lastError = "Response was not valid JSON.";
        }
        if (parsed !== undefined) {
          const result = req.schema.safeParse(parsed);
          if (result.success) return { value: result.data, mode: "live", model: res.model ?? model };
          lastError = result.error.issues
            .slice(0, 10)
            .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
            .join("; ");
        }
        messages.push({ role: "assistant", content }, { role: "user", content: `That JSON failed validation: ${lastError}. Return corrected JSON only.` });
      }
      throw new Error(`${req.task}: model output failed validation after ${attempts} attempts (${lastError})`);
    },
  };
}
