import { DEFAULT_MUBIT_MODEL, type MubitConfig } from "./mubit";

export const DEFAULT_MUBIT_EMBED_MODEL = "text-embedding-3-large";

export const DEFAULT_MUBIT_BASE_URL = "https://api.mubit.ai/openai/v1";

/** Mubit settings from the environment, or null when no key is set (offline mode). */
export function mubitConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MubitConfig | null {
  // OFFLINE=1 forces the labelled stand-ins even when a key is present.
  if (!env.MUBIT_API_KEY || env.OFFLINE === "1") return null;
  return {
    apiKey: env.MUBIT_API_KEY,
    baseURL: env.MUBIT_BASE_URL || DEFAULT_MUBIT_BASE_URL,
    taskHeader: env.MUBIT_TASK_HEADER || "X-Mubit-Task",
    // PRD: Mubit serves text-embedding-3-large; "off" opts into the hashed stand-in.
    embedModel: env.MUBIT_EMBED_MODEL === "off" ? null : env.MUBIT_EMBED_MODEL || DEFAULT_MUBIT_EMBED_MODEL,
    pricePerMInput: Number(env.MUBIT_PRICE_INPUT_PER_M || 0),
    pricePerMOutput: Number(env.MUBIT_PRICE_OUTPUT_PER_M || 0),
    model: env.MUBIT_MODEL || DEFAULT_MUBIT_MODEL,
  };
}

/** The frontier model used as v0 until an adapter is promoted. */
export function defaultModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.MUBIT_API_KEY ? env.MUBIT_MODEL || DEFAULT_MUBIT_MODEL : "offline-baseline";
}
