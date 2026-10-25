import OpenAI from "openai";
import type { z } from "zod";
import { hashedEmbedding } from "./embeddings";
import type { ChatRequest, ChatResult, LlmClient } from "./types";

// THE Mubit adapter. Every LLM and embedding call in the app goes through this file: Mubit's
// OpenAI-compatible gateway (`MUBIT_BASE_URL`, default https://api.mubit.ai/openai/v1), gpt-*
// models only (the gateway serves no Claude), each call tagged with its task name so Mubit can
// learn per task, and the Mubit request id kept so corrections can be fed back.

/** A message for `json()`/`text()`: plain text, or text plus images (data: or https: URLs). */
export type MubitMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "user"; content: string; images: string[] };

export interface MubitJsonRequest<T> {
  /** Stable task name, sent as the Mubit task header (e.g. "brand.recommend", "brain.extract"). */
  task: string;
  /** Fixed system prompt from code. */
  system: string;
  /** Everything that varies. A string is one user message. */
  user: string | MubitMessage[];
  schema: z.ZodType<T>;
  /** Extra rule checks after the schema; returned strings are fed back to the model as errors. */
  validate?: (value: T) => string[];
  model?: string;
  /** Further attempts after a validation failure (default 2). */
  retries?: number;
  /** Include the JSON Schema in the prompt (for big schemas JSON mode alone under-specifies). */
  jsonSchema?: unknown;
  onAttempt?: (info: { attempt: number; errors: string[]; ms: number; usage: { input: number; output: number } }) => void | Promise<void>;
}

export interface MubitJsonResult<T> {
  value: T;
  model: string;
  /** Mubit's id for the final call — the key for feedback/corrections. */
  requestId: string | null;
  attempts: number;
}

function toOpenAi(messages: MubitMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) =>
    "images" in m && m.images.length
      ? { role: "user", content: [{ type: "text", text: m.content }, ...m.images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] }
      : { role: m.role, content: m.content },
  );
}

export interface MubitConfig {
  apiKey: string;
  baseURL: string;
  /** Header that tags each request with its task name. Mubit also identifies tasks by system prompt. */
  taskHeader: string;
  embedModel: string | null;
  pricePerMInput: number;
  pricePerMOutput: number;
  /** Default chat model; gpt-* only. */
  model?: string;
}

/** The gateway serves gpt-* models only (verified 2026-10-24); never default to a Claude name. */
export const DEFAULT_MUBIT_MODEL = "gpt-5.4-mini";

function requestIdOf(headers: Headers, fallback?: string | null): string | null {
  // The gateway sends its own id as x-middleware-request-id (mreq_…, what Mubit errors and feedback
  // refer to); x-request-id is the upstream provider's.
  return headers.get("x-mubit-request-id") ?? headers.get("x-middleware-request-id") ?? headers.get("x-request-id") ?? fallback ?? null;
}

/** Every LLM call goes through Mubit's OpenAI-compatible endpoint: the one-line base URL change. */
export class MubitClient implements LlmClient {
  readonly mode = "mubit" as const;
  private readonly openai: OpenAI;

  constructor(
    private readonly config: MubitConfig,
    openai?: OpenAI,
  ) {
    this.openai = openai ?? new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, maxRetries: 2 });
  }

  /** Default gpt-* model (`MUBIT_MODEL`). */
  get model(): string {
    return this.config.model ?? DEFAULT_MUBIT_MODEL;
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
      requestId: requestIdOf(response.headers, data.id),
      latencyMs: Date.now() - started,
      usage: { input, output },
      costUsd: (input * this.config.pricePerMInput + output * this.config.pricePerMOutput) / 1_000_000,
    };
  }

  async embed(texts: string[], opts: { dimensions?: number } = {}): Promise<number[][]> {
    if (!this.config.embedModel) return texts.map(hashedEmbedding);
    const res = await this.openai.embeddings.create(
      { model: this.config.embedModel, input: texts, ...(opts.dimensions ? { dimensions: opts.dimensions } : {}) },
      { headers: { [this.config.taskHeader]: "embed" } },
    );
    return res.data.map((d) => d.embedding);
  }

  /** One free-text completion (no JSON mode). */
  async text(req: { task: string; system?: string; user: string | MubitMessage[]; model?: string; maxTokens?: number }) {
    const messages = toOpenAi(typeof req.user === "string" ? [{ role: "user", content: req.user }] : req.user);
    const { data, response } = await this.openai.chat.completions
      .create(
        { model: req.model ?? this.model, messages: req.system ? [{ role: "system", content: req.system }, ...messages] : messages, ...(req.maxTokens ? { max_completion_tokens: req.maxTokens } : {}) },
        { headers: { [this.config.taskHeader]: req.task } },
      )
      .withResponse();
    return {
      text: data.choices[0]?.message?.content ?? "",
      model: data.model ?? req.model ?? this.model,
      requestId: requestIdOf(response.headers, data.id),
      usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
    };
  }

  /**
   * Structured output: JSON mode + Zod. Validation errors go back to the model for `retries`
   * further attempts, then the last errors are thrown (never shown in the UI as-is).
   */
  async json<T>(req: MubitJsonRequest<T>): Promise<MubitJsonResult<T>> {
    const model = req.model ?? this.model;
    const base: MubitMessage[] = typeof req.user === "string" ? [{ role: "user", content: req.user }] : [...req.user];
    if (req.jsonSchema) {
      const last = base[base.length - 1];
      base[base.length - 1] = { ...last, content: `${last.content}\n\nRespond with one JSON object conforming to this JSON Schema:\n${JSON.stringify(req.jsonSchema)}` } as MubitMessage;
    }
    // JSON mode requires the prompt to mention JSON; a fixed suffix keeps system prompts fixed strings.
    const system = /json/i.test(req.system) ? req.system : `${req.system}\n\nRespond with a single JSON object only.`;
    const messages = [{ role: "system" as const, content: system }, ...toOpenAi(base)];
    const attempts = (req.retries ?? 2) + 1;
    let errors: string[] = [];
    for (let i = 0; i < attempts; i++) {
      const t0 = Date.now();
      const { data, response } = await this.openai.chat.completions
        .create({ model, messages, response_format: { type: "json_object" } }, { headers: { [this.config.taskHeader]: req.task } })
        .withResponse();
      const content = data.choices[0]?.message?.content ?? "";
      let value: T | undefined;
      try {
        const parsed = req.schema.safeParse(JSON.parse(content));
        if (parsed.success) {
          value = parsed.data;
          errors = req.validate?.(parsed.data) ?? [];
        } else errors = parsed.error.issues.slice(0, 30).map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`);
      } catch (err) {
        errors = [`Response was not valid JSON: ${(err as Error).message}`];
      }
      await req.onAttempt?.({ attempt: i + 1, errors, ms: Date.now() - t0, usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 } });
      if (value !== undefined && errors.length === 0) {
        return { value, model: data.model ?? model, requestId: requestIdOf(response.headers, data.id), attempts: i + 1 };
      }
      messages.push(
        { role: "assistant", content: content || "(empty)" },
        { role: "user", content: `That output failed validation. Fix every problem and return the complete corrected JSON.\n${errors.map((e) => `- ${e}`).join("\n")}` },
      );
    }
    throw new Error(`${req.task}: output failed validation after ${attempts} attempts: ${errors.slice(0, 5).join("; ")}`);
  }
}
