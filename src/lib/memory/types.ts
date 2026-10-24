// Every memory operation the app performs. Nothing outside src/lib/memory talks to a memory backend.

export interface SiteFact {
  content: string;
  sourceUrl?: string;
}

export interface Decision {
  what: string;
  why?: string;
  kind: "model_confirmed" | "answer" | "variant_picked" | "chat_change_accepted";
}

export interface Outcome {
  kind: "validation_failed" | "change_rejected" | "change_undone" | "flow_published";
  detail: string;
  success: boolean;
}

export interface ContextItem {
  kind: "fact" | "decision" | "outcome" | "lesson";
  content: string;
  sourceUrl?: string | null;
  createdAt?: string;
}

export interface ProjectContext {
  provider: string;
  items: ContextItem[];
  text: string;
  tokensEstimated: number;
}

export interface MemoryProvider {
  readonly name: string;
  rememberSiteFacts(projectId: string, agentId: string, facts: SiteFact[]): Promise<void>;
  rememberDecision(projectId: string, agentId: string, decision: Decision): Promise<void>;
  getProjectContext(projectId: string, agentId: string, query: string, tokenBudget: number): Promise<ProjectContext>;
  recordOutcome(projectId: string, agentId: string, outcome: Outcome): Promise<void>;
  reflect(projectId: string, agentId: string): Promise<{ lessons: string[] }>;
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);
