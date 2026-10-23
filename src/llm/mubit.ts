import OpenAI from "openai";
import { hashedEmbedding } from "./embeddings";
import type { ChatRequest, ChatResult, LlmClient } from "./types";

export interface MubitConfig {
  apiKey: string;
  baseURL: string;
  /** Header that tags each request with its task name. Mubit also identifies tasks by system prompt. */
  taskHeader: string;
  embedModel: string | null;
  pricePerMInput: number;
  pricePerMOutput: number;
}

/** Every LLM call goes through Mubit's OpenAI-compatible endpoint: the one-line base URL change. */
export class MubitClient implements LlmClient {
  readonly mode = "mubit" as const;
  private readonly openai: OpenAI;

  constructor(private readonly config: MubitConfig, openai?: OpenAI) {
    this.openai = openai ?? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  }

  async chat<M>(req: ChatRequest<M>): Promise<ChatResult> {
    const started = Date.now();
    const { data, response } = await this.openai.chat.completions
      .create(
        {
          model: req.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        },
        { headers: { [this.config.taskHeader]: req.task } },
      )
      .withResponse();
    const input = data.usage?.prompt_tokens ?? 0;
    const output = data.usage?.completion_tokens ?? 0;
    return {
      content: data.choices[0]?.message?.content ?? "",
      model: data.model ?? req.model,
      requestId: response.headers.get("x-mubit-request-id") ?? response.headers.get("x-request-id") ?? data.id ?? null,
      latencyMs: Date.now() - started,
      usage: { input, output },
      costUsd: (input * this.config.pricePerMInput + output * this.config.pricePerMOutput) / 1_000_000,
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.config.embedModel) return texts.map(hashedEmbedding);
    const res = await this.openai.embeddings.create({ model: this.config.embedModel, input: texts });
    return res.data.map((d) => d.embedding);
  }
}
