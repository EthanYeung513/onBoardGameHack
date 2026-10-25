// SDK-free helpers for course learning, safe in Convex's default runtime (the Mubit memory SDK
// itself uses gRPC and only loads in Node: convex/courseLearningNode.ts, the worker).

/** Same switch as brand learning: MEMORY_PROVIDER=mubit with a key, and not forced offline. */
export function courseMemoryEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MEMORY_PROVIDER === "mubit" && Boolean(env.MUBIT_API_KEY) && env.OFFLINE !== "1";
}

/** The recall query for a company: its own preferences and those of similar companies. */
export const recallQuery = (company: { name: string; host?: string; category?: string }) =>
  `How do managers like onboarding courses written for ${company.name}${company.host ? ` (${company.host})` : ""}${company.category ? `, a ${company.category} company` : ""}, and for similar companies?`;

/** Rejects after `ms` so a slow memory backend can't stall the loop or a generation. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)))]).finally(() => clearTimeout(timer));
}
