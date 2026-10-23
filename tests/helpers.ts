import path from "node:path";
import { eq } from "drizzle-orm";
import { acmePay } from "../content/acme-pay/world";
import { connectPglite, type DB } from "@/db/client";
import { seedWorld } from "@/db/seed";
import * as t from "@/db/schema";
import { hashedEmbedding } from "@/llm/embeddings";
import type { ChatRequest, ChatResult, LlmClient } from "@/llm/types";

export const contentDir = path.join(process.cwd(), "content", "acme-pay");

export async function seededDb(): Promise<{ db: DB; companyId: string; learnerId: string }> {
  const db = await connectPglite({ memory: true });
  const seeded = await seedWorld(db, acmePay, contentDir, "frontier-test");
  return { db, ...seeded };
}

export async function cardByPrompt(db: DB, startsWith: string) {
  const rows = await db.select().from(t.cards);
  const card = rows.find((c) => c.prompt.startsWith(startsWith));
  if (!card) throw new Error(`No card starting "${startsWith}"`);
  return card;
}

export async function cardsOfType(db: DB, type: t.CardType) {
  return db.select().from(t.cards).where(eq(t.cards.type, type));
}

/** A fake LLM that replies with scripted contents (a function can compute the reply from the request). */
export class FakeLlm implements LlmClient {
  readonly mode = "mubit" as const;
  readonly requests: ChatRequest[] = [];
  constructor(private readonly replies: (string | ((req: ChatRequest) => string))[]) {}

  async chat<M>(req: ChatRequest<M>): Promise<ChatResult> {
    this.requests.push(req as ChatRequest);
    const next = this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    const content = typeof next === "function" ? next(req as ChatRequest) : next;
    return { content, model: req.model, requestId: `req-${this.requests.length}`, latencyMs: 100, usage: { input: 10, output: 5 }, costUsd: 0.001 };
  }

  async embed(texts: string[]) {
    return texts.map(hashedEmbedding);
  }
}
