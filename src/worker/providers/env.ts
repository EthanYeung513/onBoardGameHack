/** Provider switches for the worker. `OFFLINE=1` forces stand-ins even when keys exist. */
export function providerEnv() {
  const offline = process.env.OFFLINE === "1";
  const key = offline ? "" : (process.env.MUBIT_API_KEY ?? "");
  return {
    mubitKey: key,
    baseURL: process.env.MUBIT_BASE_URL || "https://api.mubit.ai/openai/v1",
    model: process.env.MUBIT_MODEL || "gpt-5.4-mini",
    embedModel: process.env.MUBIT_EMBED_MODEL || "text-embedding-3-large",
    taskHeader: process.env.MUBIT_TASK_HEADER || "X-Mubit-Task",
    live: Boolean(key),
  };
}
