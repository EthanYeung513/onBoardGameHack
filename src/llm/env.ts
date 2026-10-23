import type { MubitConfig } from "./mubit";

export const DEFAULT_MUBIT_BASE_URL = "https://api.mubit.ai/openai/v1";

/** Mubit settings from the environment, or null when no key is set (offline mode). */
export function mubitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MubitConfig | null {
  if (!env.MUBIT_API_KEY) return null;
  return {
    apiKey: env.MUBIT_API_KEY,
    baseURL: env.MUBIT_BASE_URL || DEFAULT_MUBIT_BASE_URL,
    taskHeader: env.MUBIT_TASK_HEADER || "X-Mubit-Task",
    embedModel: env.MUBIT_EMBED_MODEL || null,
    pricePerMInput: Number(env.MUBIT_PRICE_INPUT_PER_M || 0),
    pricePerMOutput: Number(env.MUBIT_PRICE_OUTPUT_PER_M || 0),
  };
}

/** The frontier model used as v0 until an adapter is promoted. */
export function defaultModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUBIT_API_KEY ? env.MUBIT_MODEL || "gpt-4.1-mini" : "offline-baseline";
}
