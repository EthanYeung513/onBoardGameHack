import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env, gatewayEnabled } from "@/lib/env";

// The only place an Anthropic client is created. Calls go through the Mubit gateway when it is
// enabled and fall back to the direct Anthropic API if the gateway fails and a direct key exists.

export type Route = "gateway" | "direct";

export interface CallLog {
  (level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void | Promise<void>;
}

const clients = new Map<Route, Anthropic>();

export function anthropicClient(route: Route): Anthropic {
  const existing = clients.get(route);
  if (existing) return existing;
  // Mubit rejects calls that carry a second credential.
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  const e = env();
  const client =
    route === "gateway"
      ? new Anthropic({ apiKey: e.MUBIT_API_KEY, authToken: null, baseURL: `${e.MUBIT_ENDPOINT.replace(/\/$/, "")}/anthropic`, maxRetries: 1 })
      : new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, authToken: null, baseURL: "https://api.anthropic.com", maxRetries: 2 });
  clients.set(route, client);
  return client;
}

export function routes(): Route[] {
  const e = env();
  const out: Route[] = [];
  if (gatewayEnabled(e) && e.MUBIT_API_KEY) out.push("gateway");
  if (e.ANTHROPIC_API_KEY) out.push("direct");
  if (out.length === 0) throw new Error("No model credentials: set MUBIT_API_KEY or ANTHROPIC_API_KEY");
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

/** Applies the project metadata and effort setting every call must carry. */
function withDefaults<P extends CreateParams>(params: P, ctx: CallContext) {
  const e = env();
  return {
    ...params,
    model: params.model ?? e.ANTHROPIC_MODEL,
    metadata: { user_id: `project:${ctx.projectId}` },
    output_config: { effort: e.ANTHROPIC_EFFORT, ...(params.output_config ?? {}) },
  };
}

async function withFallback<T>(ctx: CallContext, fn: (client: Anthropic, route: Route) => Promise<T>): Promise<{ value: T; route: Route; ms: number }> {
  const list = routes();
  let lastErr: unknown;
  for (const route of list) {
    const t0 = Date.now();
    try {
      const value = await fn(anthropicClient(route), route);
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
  const { value, route, ms } = await withFallback(ctx, (c) => c.messages.create(withDefaults(params, ctx)));
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
     * instead, for schemas too large for constrained decoding; Zod still validates the result.
     */
    mode?: "constrained" | "prompted";
    jsonSchema?: unknown;
  },
): Promise<{ data: z.infer<S>; route: Route; attempts: number }> {
  const retries = ctx.retries ?? 2;
  const prompted = ctx.mode === "prompted";
  const messages = [...params.messages];
  if (prompted) {
    const instruction = `Respond with a single JSON object that conforms to this JSON Schema, with no prose and no code fences.\n\n${JSON.stringify(ctx.jsonSchema ?? z.toJSONSchema(schema))}`;
    const last = messages[messages.length - 1];
    if (last?.role === "user" && typeof last.content === "string") messages[messages.length - 1] = { role: "user", content: `${last.content}\n\n${instruction}` };
    else if (last?.role === "user" && Array.isArray(last.content)) messages[messages.length - 1] = { role: "user", content: [...last.content, { type: "text", text: instruction }] };
    else messages.push({ role: "user", content: instruction });
  }
  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { value: msg, route, ms } = await withFallback(ctx, (c) =>
      c.messages.create(withDefaults(prompted ? { ...params, messages } : { ...params, messages, output_config: { format: zodOutputFormat(schema) } }, ctx)),
    );
    const raw = textOf(msg);
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
      errors = [`Response was not valid JSON: ${(err as Error).message}`];
    }
    await ctx.log?.(errors.length ? "warn" : "info", `Model call ${ctx.task} via ${route} (attempt ${attempt + 1})`, {
      ms,
      usage: msg.usage,
      stop: msg.stop_reason,
      errors: errors.slice(0, 10),
    });
    if (data !== undefined && errors.length === 0) return { data, route, attempts: attempt + 1 };
    lastErrors = errors;
    messages.push({ role: "assistant", content: raw || "(empty)" });
    messages.push({
      role: "user",
      content: `That output failed validation. Fix every problem and return the complete corrected JSON.\n\n${errors.slice(0, 30).map((e) => `- ${e}`).join("\n")}`,
    });
  }
  throw new Error(`Output failed validation after ${retries + 1} attempts: ${lastErrors.slice(0, 5).join("; ")}`);
}

/**
 * Vercel AI SDK model for the streaming chat, configured the same way as the client above:
 * through the Mubit gateway when enabled, with the effort setting and the project session id.
 */
export async function chatModel(projectId: string) {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  const e = env();
  const route = routes()[0];
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  const provider =
    route === "gateway"
      ? createAnthropic({ apiKey: e.MUBIT_API_KEY, baseURL: `${e.MUBIT_ENDPOINT.replace(/\/$/, "")}/anthropic/v1` })
      : createAnthropic({ apiKey: e.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" });
  return {
    route,
    model: provider(e.ANTHROPIC_MODEL),
    providerOptions: { anthropic: { effort: e.ANTHROPIC_EFFORT, metadata: { userId: `project:${projectId}` } } },
  };
}
