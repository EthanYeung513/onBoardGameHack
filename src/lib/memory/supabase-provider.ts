import { supabaseAdmin } from "@/lib/supabase/admin";
import { estimateTokens, type ContextItem, type MemoryProvider } from "./types";

// Memory kept in Postgres. Recall ranks by keyword overlap, kind and recency, then fills the
// token budget. Global lessons from reflect() are shared across projects.

const KIND_WEIGHT: Record<ContextItem["kind"], number> = { decision: 3, outcome: 2.5, lesson: 2, fact: 1 };

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

export class SupabaseMemoryProvider implements MemoryProvider {
  readonly name = "supabase";

  private async insert(rows: Array<Record<string, unknown>>) {
    const { error } = await supabaseAdmin().from("memory_items").insert(rows);
    if (error) throw new Error(error.message);
  }

  async rememberSiteFacts(projectId: string, agentId: string, facts: Array<{ content: string; sourceUrl?: string }>) {
    if (facts.length === 0) return;
    await this.insert(facts.map((f) => ({ project_id: projectId, agent_id: agentId, kind: "fact", content: f.content, source_url: f.sourceUrl ?? null })));
  }

  async rememberDecision(projectId: string, agentId: string, d: { what: string; why?: string; kind: string }) {
    await this.insert([{ project_id: projectId, agent_id: agentId, kind: "decision", content: d.why ? `${d.what} Reason: ${d.why}` : d.what, importance: 0.8, meta: { decision: d.kind } }]);
  }

  async recordOutcome(projectId: string, agentId: string, o: { kind: string; detail: string; success: boolean }) {
    await this.insert([{ project_id: projectId, agent_id: agentId, kind: "outcome", content: `${o.success ? "Worked" : "Did not work"}: ${o.detail}`, importance: o.success ? 0.6 : 0.9, meta: { outcome: o.kind, success: o.success } }]);
  }

  async getProjectContext(projectId: string, _agentId: string, query: string, tokenBudget: number) {
    const sb = supabaseAdmin();
    const [own, global] = await Promise.all([
      sb.from("memory_items").select("kind, content, source_url, importance, created_at").eq("project_id", projectId).order("created_at", { ascending: false }).limit(300),
      sb.from("memory_items").select("kind, content, source_url, importance, created_at").eq("scope", "global").order("created_at", { ascending: false }).limit(50),
    ]);
    if (own.error) throw new Error(own.error.message);
    const q = words(query);
    const now = Date.now();
    const rows = [...(own.data ?? []), ...(global.data ?? [])];
    const scored = rows.map((r, i) => {
      const overlap = [...words(r.content)].filter((w) => q.has(w)).length;
      const ageHours = (now - new Date(r.created_at).getTime()) / 3.6e6;
      const score = KIND_WEIGHT[r.kind as ContextItem["kind"]] + overlap * 0.5 + Number(r.importance) - Math.min(ageHours / 48, 1) - i * 0.001;
      return { r, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const items: ContextItem[] = [];
    let used = 0;
    for (const { r } of scored) {
      const line = `[${r.kind}] ${r.content}${r.source_url ? ` (source ${r.source_url})` : ""}`;
      const cost = estimateTokens(line);
      if (used + cost > tokenBudget) continue;
      used += cost;
      items.push({ kind: r.kind, content: r.content, sourceUrl: r.source_url, createdAt: r.created_at });
    }
    const text = items.map((i) => `- [${i.kind}] ${i.content}${i.sourceUrl ? ` (source ${i.sourceUrl})` : ""}`).join("\n");
    return { provider: this.name, items, text, tokensEstimated: used };
  }

  async reflect(projectId: string, agentId: string) {
    // Promote failed outcomes that repeat across projects into global lessons.
    const sb = supabaseAdmin();
    const { data, error } = await sb.from("memory_items").select("content, project_id").eq("kind", "outcome").eq("meta->>success", "false").order("created_at", { ascending: false }).limit(500);
    if (error) throw new Error(error.message);
    const byText = new Map<string, Set<string>>();
    for (const r of data ?? []) {
      const key = r.content.replace(/\d+/g, "#").slice(0, 160);
      if (!byText.has(key)) byText.set(key, new Set());
      byText.get(key)!.add(r.project_id);
    }
    const lessons = [...byText.entries()].filter(([, p]) => p.size >= 2 || p.has(projectId)).map(([k]) => `Avoid repeating: ${k.replace(/^Did not work: /, "")}`).slice(0, 10);
    if (lessons.length) {
      const { data: existing } = await sb.from("memory_items").select("content").eq("scope", "global").eq("kind", "lesson");
      const have = new Set((existing ?? []).map((e) => e.content));
      const fresh = lessons.filter((l) => !have.has(l));
      if (fresh.length) await this.insert(fresh.map((content) => ({ project_id: null, scope: "global", agent_id: agentId, kind: "lesson", content, importance: 0.7 })));
    }
    return { lessons };
  }
}
