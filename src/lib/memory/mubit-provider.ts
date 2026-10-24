import { Client } from "@mubit-ai/sdk";
import { env, requireEnv } from "@/lib/env";
import { estimateTokens, type MemoryProvider } from "./types";

// Mubit memory API (remember, recall, getContext, recordOutcome, reflect). Only selected when the
// configured key answers on this surface; see probeMubitMemory().

type Loose = Record<string, unknown>;

export class MubitMemoryProvider implements MemoryProvider {
  readonly name = "mubit";
  private clients = new Map<string, Client>();

  private client(projectId: string) {
    const session = `project:${projectId}`;
    let c = this.clients.get(session);
    if (!c) {
      c = new Client({ transport: "http", endpoint: env().MUBIT_ENDPOINT, run_id: session, api_key: requireEnv("MUBIT_API_KEY") } as never);
      this.clients.set(session, c);
    }
    return { c: c as unknown as Record<string, (args: Loose) => Promise<Loose>>, session };
  }

  async rememberSiteFacts(projectId: string, agentId: string, facts: Array<{ content: string; sourceUrl?: string }>) {
    const { c, session } = this.client(projectId);
    for (const f of facts) {
      await c.remember({ session_id: session, agent_id: agentId, content: f.sourceUrl ? `${f.content} (source ${f.sourceUrl})` : f.content, intent: "fact" });
    }
  }

  async rememberDecision(projectId: string, agentId: string, d: { what: string; why?: string; kind: string }) {
    const { c, session } = this.client(projectId);
    await c.remember({ session_id: session, agent_id: agentId, content: d.why ? `${d.what} Reason: ${d.why}` : d.what, intent: "decision", metadata: { kind: d.kind } });
  }

  async recordOutcome(projectId: string, agentId: string, o: { kind: string; detail: string; success: boolean }) {
    const { c, session } = this.client(projectId);
    await c.recordOutcome({ session_id: session, agent_id: agentId, outcome: o.success ? "success" : "failure", summary: o.detail, metadata: { kind: o.kind } });
  }

  async getProjectContext(projectId: string, agentId: string, query: string, tokenBudget: number) {
    const { c, session } = this.client(projectId);
    const res = await c.getContext({ session_id: session, agent_id: agentId, query, max_tokens: tokenBudget });
    const text = String(res.context ?? res.text ?? res.final_answer ?? "");
    return { provider: this.name, items: text ? [{ kind: "fact" as const, content: text }] : [], text, tokensEstimated: estimateTokens(text) };
  }

  async reflect(projectId: string, agentId: string) {
    const { c, session } = this.client(projectId);
    const res = await c.reflect({ session_id: session, agent_id: agentId });
    const lessons = Array.isArray(res.lessons) ? (res.lessons as unknown[]).map(String) : [];
    return { lessons };
  }
}

/** One remember plus one recall in a scratch session. Resolves with an error message on failure. */
export async function probeMubitMemory(): Promise<{ ok: boolean; error?: string }> {
  try {
    const c = new Client({ transport: "http", endpoint: env().MUBIT_ENDPOINT, run_id: "probe:env-check", api_key: requireEnv("MUBIT_API_KEY") } as never) as unknown as Record<string, (a: Loose) => Promise<Loose>>;
    await c.remember({ session_id: "probe:env-check", agent_id: "env-check", content: "Environment check probe.", intent: "fact" });
    await c.recall({ session_id: "probe:env-check", query: "environment check" });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.slice(0, 300) };
  }
}
