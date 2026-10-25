import type OpenAI from "openai";
import type { z } from "zod";
import { mubitConfigFromEnv } from "@/llm/env";
import { MubitClient } from "@/llm/mubit";

// The worker's LLM: a thin wrapper over the one Mubit adapter (src/llm/mubit.ts). With no key it
// uses the caller's labelled offline stand-in, or throws ProviderOffline (503, never faked).

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
  /** Extra rule checks fed back to the model as validation errors. */
  validate?: (value: T) => string[];
  /** Deterministic stand-in used when the provider is unconfigured; results must be labelled offline. */
  offline?: () => T;
  model?: string;
  retries?: number;
}

export interface JsonResult<T> {
  value: T;
  mode: "live" | "offline";
  model: string;
  /** Mubit request id of the accepted call (for feedback/corrections); null offline. */
  requestId: string | null;
}

export interface Llm {
  readonly live: boolean;
  json<T>(req: JsonRequest<T>): Promise<JsonResult<T>>;
}

/** `openai` injects a fake transport in tests; production always builds MubitClient from env. */
export function createLlm(openai?: OpenAI): Llm {
  const config = mubitConfigFromEnv();
  const mubit = config ? new MubitClient(config, openai) : null;
  return {
    live: Boolean(mubit),
    async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
      if (!mubit) {
        if (!req.offline) throw new ProviderOffline("The LLM provider");
        return { value: req.schema.parse(req.offline()), mode: "offline", model: "offline-stand-in", requestId: null };
      }
      const r = await mubit.json({ task: req.task, system: req.system, user: req.user, schema: req.schema, validate: req.validate, model: req.model, retries: req.retries });
      return { value: r.value, mode: "live", model: r.model, requestId: r.requestId };
    },
  };
}
