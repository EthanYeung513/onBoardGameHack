export type TaskName = "grade" | "generate";

export interface ChatRequest<M = unknown> {
  task: TaskName;
  model: string;
  system: string;
  user: string;
  /** The structured input the user message was built from. The offline client grades from this, not the prose. */
  meta: M;
}

export interface ChatResult {
  content: string;
  model: string;
  requestId: string | null;
  latencyMs: number;
  usage: { input: number; output: number };
  costUsd: number;
}

export interface LlmClient {
  readonly mode: "mubit" | "offline";
  chat<M>(req: ChatRequest<M>): Promise<ChatResult>;
  embed(texts: string[]): Promise<number[][]>;
}
