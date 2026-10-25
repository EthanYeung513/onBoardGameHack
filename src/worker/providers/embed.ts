import type OpenAI from "openai";
import { EMBEDDING_DIMS } from "@convex/schema";
import { mubitConfigFromEnv } from "@/llm/env";
import { MubitClient } from "@/llm/mubit";

// Embeddings through the Mubit adapter: `MUBIT_EMBED_MODEL` (text-embedding-3-large) at 1536 dims,
// or a hashed bag-of-words stand-in of the same width when offline (labelled `offline`).

export interface Embedder {
  readonly mode: "live" | "offline";
  embed(texts: string[]): Promise<number[][]>;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashedEmbedding(text: string, dims = EMBEDDING_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().match(/[a-z0-9£$€#-]+/g) ?? [];
  const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  for (const f of features) v[fnv1a(f) % dims] += 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

export function createEmbedder(openai?: OpenAI): Embedder {
  const config = mubitConfigFromEnv();
  if (!config?.embedModel) return { mode: "offline", embed: async (texts) => texts.map((t) => hashedEmbedding(t)) };
  const mubit = new MubitClient(config, openai);
  return {
    mode: "live",
    async embed(texts) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 64) {
        const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 24_000) || " ");
        for (const v of await mubit.embed(batch, { dimensions: EMBEDDING_DIMS })) {
          if (v.length !== EMBEDDING_DIMS) throw new Error(`Embedding width ${v.length} ≠ ${EMBEDDING_DIMS}`);
          out.push(v);
        }
      }
      return out;
    },
  };
}
