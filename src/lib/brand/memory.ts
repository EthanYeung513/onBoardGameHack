// Mubit memory for brand preferences (remember / recall / recordOutcome), one global
// `brand-preferences` agent so what one company's manager chose informs the next company.
// Enabled with MEMORY_PROVIDER=mubit (the existing switch; the memory surface is not served for
// every key — the gateway-only key answers `unknown_route`). Callers audit failures; nothing here
// is allowed to block a scan or the Design tab.

export const BRAND_AGENT = "brand-preferences";
export const BRAND_SESSION = "brand-preferences";

export interface BrandMemory {
  readonly name: "mubit";
  recall(query: string): Promise<string>;
  remember(d: { content: string; metadata: Record<string, string> }): Promise<void>;
  recordOutcome(o: { referenceId: string; success: boolean; summary: string; metadata: Record<string, string> }): Promise<void>;
}

type Loose = Record<string, unknown>;
export type MemoryClient = Record<"remember" | "recall" | "recordOutcome", (args: Loose) => Promise<Loose>>;

export class MubitBrandMemory implements BrandMemory {
  readonly name = "mubit" as const;
  constructor(private readonly client: () => Promise<MemoryClient>) {}

  async recall(query: string) {
    const c = await this.client();
    const res = await c.recall({ session_id: BRAND_SESSION, agent_id: BRAND_AGENT, query });
    return String(res.final_answer ?? res.context ?? res.text ?? "").slice(0, 2000);
  }

  async remember(d: { content: string; metadata: Record<string, string> }) {
    const c = await this.client();
    await c.remember({ session_id: BRAND_SESSION, agent_id: BRAND_AGENT, content: d.content, intent: "decision", metadata: d.metadata });
  }

  async recordOutcome(o: { referenceId: string; success: boolean; summary: string; metadata: Record<string, string> }) {
    const c = await this.client();
    await c.recordOutcome({ session_id: BRAND_SESSION, agent_id: BRAND_AGENT, reference_id: o.referenceId, outcome: o.success ? "success" : "failure", summary: o.summary, metadata: o.metadata });
  }
}

export function brandMemoryEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MEMORY_PROVIDER === "mubit" && Boolean(env.MUBIT_API_KEY) && env.OFFLINE !== "1";
}

/** Mubit memory when enabled, otherwise null (callers record "skipped" honestly). */
export function brandMemoryFromEnv(env: NodeJS.ProcessEnv = process.env): BrandMemory | null {
  if (!brandMemoryEnabled(env)) return null;
  let cached: MemoryClient | undefined;
  return new MubitBrandMemory(async () => {
    if (!cached) {
      const { Client } = await import("@mubit-ai/sdk");
      cached = new Client({ transport: "http", endpoint: env.MUBIT_ENDPOINT || "https://api.mubit.ai", run_id: BRAND_SESSION, api_key: env.MUBIT_API_KEY } as never) as unknown as MemoryClient;
    }
    return cached;
  });
}

/** Rejects after `ms` so a slow memory backend can't stall a scan slice. */
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms))]);
}
