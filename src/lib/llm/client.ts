import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env, gatewayEnabled } from "@/lib/env";
import { mubitConfigFromEnv } from "@/llm/env";
import { MubitClient, type MubitMessage } from "@/llm/mubit";

// Legacy studio LLM entry point (Anthropic-shaped params). The `gateway` route is Mubit's
// OpenAI-compatible gateway via the one adapter, src/llm/mubit.ts — gpt-* models only; the gateway
// serves no Claude, so Mubit keys are never sent to an /anthropic path. `direct` is the optional
// paid Anthropic fallback and is used only when ANTHROPIC_API_KEY is set.

export type Route = "gateway" | "direct";

export interface CallLog {
  (level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void | Promise<void>;
}

let direct: Anthropic | undefined;
let mubit: MubitClient | undefined;

/** The direct Anthropic client (paid fallback). There is no Anthropic client for the Mubit gateway. */
export function anthropicClient(route: Route = "direct"): Anthropic {
  if (route !== "direct") throw new Error("The Mubit gateway serves gpt-* models only — use the Mubit adapter (src/llm/mubit.ts)");
  const e = env();
  if (!e.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  direct ??= new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, authToken: null, baseURL: "https://api.anthropic.com", maxRetries: 2 });
  return direct;
}

function mubitClient(): MubitClient {
  const config = mubitConfigFromEnv();
  if (!config) throw new Error("MUBIT_API_KEY is not set");
  mubit ??= new MubitClient(config);
  return mubit;
}

export function routes(): Route[] {
  const e = env();
  const out: Route[] = [];
  if (gatewayEnabled(e) && mubitConfigFromEnv()) out.push("gateway");
  if (e.ANTHROPIC_API_KEY) out.push("direct");
  if (out.length === 0) throw new Error("No model credentials: set MUBIT_API_KEY (or the optional ANTHROPIC_API_KEY)");
  return out;
}

type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "metadata" | "output_config"> & {
  model?: string;
  output_config?: Anthropic.MessageCreateParamsNonStreaming["output_config"];
};

export interface CallContext {
  projectId: string;
  task: string;
  log?: CallLog;
}

/** Applies the project metadata and effort setting every direct Anthropic call must carry. */
function withDefaults<P extends CreateParams>(params: P, ctx: CallContext) {
  const e = env();
  return {
    ...params,
    model: params.model && params.model.startsWith("claude") ? params.model : e.ANTHROPIC_MODEL,
    metadata: { user_id: `project:${ctx.projectId}` },
    output_config: { effort: e.ANTHROPIC_EFFORT, ...(params.output_config ?? {}) },
  };
}

/** Anthropic-shaped system/messages → the Mubit adapter's messages (text + images). */
function toMubit(params: CreateParams): { system: string; messages: MubitMessage[] } {
  const system = typeof params.system === "string" ? params.system : (params.system ?? []).map((b) => b.text).join("\n");
  const messages: MubitMessage[] = params.messages.map((m): MubitMessage => {
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") return { role, content: m.content };
    const text = m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? JSON.stringify(b.content) : "")).filter(Boolean).join("\n");
    const images = m.content.flatMap((b) => (b.type === "image" && b.source.type === "base64" ? [`data:${b.source.media_type};base64,${b.source.data}`] : b.type === "image" && b.source.type === "url" ? [b.source.url] : []));
    return role === "user" && images.length ? { role: "user", content: text, images } : { role, content: text };
  });
  return { system, messages };
}

/** A Mubit text result in the Anthropic message shape the studio code reads. */
function asMessage(r: { text: string; model: string; requestId: string | null; usage: { input: number; output: number } }): Anthropic.Message {
  return {
    id: r.requestId ?? "mubit",
    type: "message",
    role: "assistant",
    model: r.model,
    content: [{ type: "text", text: r.text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: r.usage.input, output_tokens: r.usage.output },
  } as unknown as Anthropic.Message;
}

async function withFallback<T>(ctx: CallContext, fn: (route: Route) => Promise<T>): Promise<{ value: T; route: Route; ms: number }> {
  const list = routes();
  let lastErr: unknown;
  for (const route of list) {
    const t0 = Date.now();
    try {
      const value = await fn(route);
      return { value, route, ms: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
      const status = err instanceof Anthropic.APIError ? err.status : undefined;
      // Bad requests fail the same way on every route, so do not retry them elsewhere.
      if (status === 400 || status === 422) throw err;
      if (route !== list[list.length - 1]) {
        await ctx.log?.("warn", `Model call via ${route} failed, falling back`, { task: ctx.task, error: String(err) });
      }
    }
  }
  throw lastErr;
}

function appendToLastUser(messages: Anthropic.MessageParam[], text: string) {
  const last = messages[messages.length - 1];
  if (last?.role === "user" && typeof last.content === "string") messages[messages.length - 1] = { role: "user", content: `${last.content}\n\n${text}` };
  else if (last?.role === "user" && Array.isArray(last.content)) messages[messages.length - 1] = { role: "user", content: [...last.content, { type: "text", text }] };
  else messages.push({ role: "user", content: text });
}

/** The outermost JSON object in a reply, ignoring any fences or prose around it. */
export function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export async function complete(params: CreateParams, ctx: CallContext) {
  const { value, route, ms } = await withFallback(ctx, async (route) => {
    if (route === "direct") return anthropicClient().messages.create(withDefaults(params, ctx));
    const { system, messages } = toMubit(params);
    return asMessage(await mubitClient().text({ task: ctx.task, system, user: messages, maxTokens: params.max_tokens }));
  });
  await ctx.log?.("info", `Model call ${ctx.task} via ${route}`, { ms, usage: value.usage, stop: value.stop_reason });
  return { message: value, text: textOf(value), route, ms };
}

/**
 * Structured output validated by Zod. Validation errors are fed back to the model for up to
 * `retries` further attempts before the last error is thrown.
 */
export async function completeJson<S extends z.ZodType>(
  schema: S,
  params: CreateParams,
  ctx: CallContext & {
    retries?: number;
    validate?: (v: z.infer<S>) => string[];
    /**
     * "constrained" uses structured outputs. "prompted" sends the JSON Schema in the user message
     * instead. "tool" asks for the object as the input of a single tool call, so the API returns
     * parsed JSON without compiling a grammar; use it for large schemas. Zod validates every mode.
     */
    mode?: "constrained" | "prompted" | "tool";
    jsonSchema?: unknown;
  },
): Promise<{ data: z.infer<S>; route: Route; attempts: number }> {
  const retries = ctx.retries ?? 2;
  if (routes()[0] === "gateway") {
    try {
      const { system, messages } = toMubit(params);
      const t0 = Date.now();
      const r = await mubitClient().json({
        task: ctx.task,
        system,
        user: messages,
        schema: schema as z.ZodType<z.infer<S>>,
        validate: ctx.validate,
        retries,
        // Tool/prompted modes carried big schemas; JSON mode needs the schema spelled out for those.
        jsonSchema: ctx.mode === "tool" || ctx.mode === "prompted" ? (ctx.jsonSchema ?? z.toJSONSchema(schema)) : undefined,
        onAttempt: ({ attempt, errors, usage }) =>
          ctx.log?.(errors.length ? "warn" : "info", `Model call ${ctx.task} via gateway (attempt ${attempt})`, { ms: Date.now() - t0, usage, errors: errors.slice(0, 10) }),
      });
      return { data: r.value, route: "gateway", attempts: r.attempts };
    } catch (err) {
      if (!routes().includes("direct")) throw err;
      await ctx.log?.("warn", "Mubit gateway call failed, falling back to direct Anthropic", { task: ctx.task, error: String(err) });
    }
  }
  const prompted = ctx.mode === "prompted";
  const viaTool = ctx.mode === "tool";
  const toolDef = viaTool
    ? {
        name: "submit_result",
        description: "Submit the complete result object.",
        input_schema: (ctx.jsonSchema ?? z.toJSONSchema(schema)) as Anthropic.Tool.InputSchema,
      }
    : null;
  const messages = [...params.messages];
  if (viaTool) appendToLastUser(messages, `Return the result by calling the ${toolDef!.name} tool once with the complete object. Do not reply with text.`);
  if (prompted) {
    appendToLastUser(messages, `Respond with a single JSON object that conforms to this JSON Schema, with no prose and no code fences.\n\n${JSON.stringify(ctx.jsonSchema ?? z.toJSONSchema(schema))}`);
  }
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const route: Route = "direct";
    const t0 = Date.now();
    const msg = await anthropicClient().messages.create(
        withDefaults(
          viaTool
            ? { ...params, messages, tools: [toolDef!], tool_choice: { type: "auto" } }
            : prompted
              ? { ...params, messages }
              : { ...params, messages, output_config: { format: zodOutputFormat(schema) } },
          ctx,
        ),
    );
    const ms = Date.now() - t0;
    const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = viaTool ? (toolUse ? JSON.stringify(toolUse.input) : "") : textOf(msg);
    let errors: string[] = [];
    let data: z.infer<S> | undefined;
    try {
      const parsed = schema.safeParse(JSON.parse(prompted ? extractJson(raw) : raw));
      if (parsed.success) {
        data = parsed.data;
        errors = ctx.validate?.(parsed.data) ?? [];
      } else {
        errors = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      }
    } catch (err) {
      errors = viaTool && !toolUse ? [`No ${toolDef!.name} tool call was made; call the tool with the complete object`] : [`Response was not valid JSON: ${(err as Error).message}`];
    }
    await ctx.log?.(errors.length ? "warn" : "info", `Model call ${ctx.task} via ${route} (attempt ${attempt + 1})`, {
      ms,
      usage: msg.usage,
      stop: msg.stop_reason,
      errors: errors.slice(0, 10),
    });
    if (data !== undefined && errors.length === 0) return { data, route, attempts: attempt + 1 };
    lastErrors = errors;
    const feedback = `That output failed validation. Fix every problem and return the complete corrected result.\n\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}`;
    if (viaTool && toolUse) {
      messages.push({ role: "assistant", content: msg.content as Anthropic.ContentBlockParam[] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, is_error: true, content: feedback }] });
    } else {
      messages.push({ role: "assistant", content: raw || "(empty)" });
      messages.push({ role: "user", content: feedback });
    }
  }
  throw new Error(`Output failed validation after ${retries + 1} attempts: ${lastErrors.slice(0, 5).join("; ")}`);
}

/**
 * Vercel AI SDK model for the streaming chat, configured the same way as the client above:
 * through the Mubit gateway when enabled, with the effort setting and the project session id.
 */
export async function chatModel(projectId: string) {
  const e = env();
  const route = routes()[0];
  if (route === "gateway") {
    // Streaming chat through the Mubit gateway's OpenAI-compatible API (gpt-* only).
    const { createOpenAI } = await import("@ai-sdk/openai");
    const config = mubitConfigFromEnv()!;
    const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, headers: { [config.taskHeader]: "studio.chat" } });
    return { route, model: provider.chat(config.model!), providerOptions: { openai: { user: `project:${projectId}` } } as Record<string, Record<string, string>> };
  }
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const provider = createAnthropic({ apiKey: e.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" });
  return {
    route,
    model: provider(e.ANTHROPIC_MODEL),
    providerOptions: { anthropic: { effort: e.ANTHROPIC_EFFORT, metadata: { userId: `project:${projectId}` } } } as Record<string, Record<string, string | Record<string, string>>>,
  };
}
