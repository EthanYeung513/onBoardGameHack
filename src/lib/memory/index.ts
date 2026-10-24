import { supabaseAdmin } from "@/lib/supabase/admin";
import { MubitMemoryProvider } from "./mubit-provider";
import { SupabaseMemoryProvider } from "./supabase-provider";
import type { Decision, MemoryProvider, Outcome, ProjectContext, SiteFact } from "./types";

export type { Decision, Outcome, ProjectContext, SiteFact } from "./types";

// MEMORY_PROVIDER selects the backend. The Mubit memory surface is not served for the current key
// (only the gateway is), so Supabase is the default.
function provider(): MemoryProvider {
  return process.env.MEMORY_PROVIDER === "mubit" ? new MubitMemoryProvider() : new SupabaseMemoryProvider();
}

let active: MemoryProvider | undefined;
export function memoryProvider(): MemoryProvider {
  active ??= provider();
  return active;
}

async function logged<T>(projectId: string | null, operation: string, scope: string, summary: string, fn: () => Promise<T>): Promise<T> {
  const p = memoryProvider();
  const t0 = Date.now();
  let ok = true;
  let error: string | null = null;
  try {
    return await fn();
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await supabaseAdmin()
      .from("memory_events")
      .insert({ project_id: projectId, provider: p.name, operation, scope, payload_summary: summary.slice(0, 500), ok, latency_ms: Date.now() - t0, error })
      .then(({ error: e }) => e && console.error("memory_events insert failed", e.message));
  }
}

// Memory never blocks the pipeline: failures are logged in memory_events and swallowed by callers
// that use the `safe` variants.

export const memory = {
  rememberSiteFacts(projectId: string, agentId: string, facts: SiteFact[]) {
    return logged(projectId, "rememberSiteFacts", agentId, `${facts.length} facts: ${facts.slice(0, 3).map((f) => f.content).join(" | ")}`, () => memoryProvider().rememberSiteFacts(projectId, agentId, facts));
  },
  rememberDecision(projectId: string, agentId: string, decision: Decision) {
    return logged(projectId, "rememberDecision", agentId, `${decision.kind}: ${decision.what}${decision.why ? ` (why: ${decision.why})` : ""}`, () => memoryProvider().rememberDecision(projectId, agentId, decision));
  },
  getProjectContext(projectId: string, agentId: string, query: string, tokenBudget = 1200): Promise<ProjectContext> {
    return logged(projectId, "getProjectContext", agentId, `query "${query.slice(0, 120)}", budget ${tokenBudget}`, () => memoryProvider().getProjectContext(projectId, agentId, query, tokenBudget));
  },
  recordOutcome(projectId: string, agentId: string, outcome: Outcome) {
    return logged(projectId, "recordOutcome", agentId, `${outcome.kind} ${outcome.success ? "ok" : "failed"}: ${outcome.detail}`, () => memoryProvider().recordOutcome(projectId, agentId, outcome));
  },
  reflect(projectId: string, agentId: string) {
    return logged(projectId, "reflect", agentId, "promote recurring lessons", () => memoryProvider().reflect(projectId, agentId));
  },
};

/** Same calls, but a memory failure only logs. Use inside pipeline stages. */
export const safeMemory = Object.fromEntries(
  Object.entries(memory).map(([k, fn]) => [
    k,
    async (...args: unknown[]) => {
      try {
        return await (fn as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch {
        return undefined;
      }
    },
  ]),
) as { [K in keyof typeof memory]: (...a: Parameters<(typeof memory)[K]>) => Promise<Awaited<ReturnType<(typeof memory)[K]>> | undefined> };
