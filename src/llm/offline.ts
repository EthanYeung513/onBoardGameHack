import { hashedEmbedding } from "./embeddings";
import type { ChatRequest, ChatResult, LlmClient, TaskName } from "./types";

export type OfflineHandler = (meta: unknown) => unknown;

/**
 * Runs without a Mubit key: each task has a deterministic rule-based handler that answers from the request's
 * structured `meta`. Used for local development, tests, and as the on-stage fallback if the network fails.
 */
export class OfflineClient implements LlmClient {
  readonly mode = "offline" as const;

  constructor(private readonly handlers: Partial<Record<TaskName, OfflineHandler>>) {}

  async chat<M>(req: ChatRequest<M>): Promise<ChatResult> {
    const started = Date.now();
    const handler = this.handlers[req.task];
    if (!handler) throw new Error(`No offline handler for task "${req.task}"`);
    const content = JSON.stringify(handler(req.meta));
    return { content, model: "offline-baseline", requestId: null, latencyMs: Date.now() - started, usage: { input: 0, output: 0 }, costUsd: 0 };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashedEmbedding);
  }
}
