const DIMS = 512;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9£#-]+/g) ?? [];
}

/**
 * Offline embedding: hashed unigrams and bigrams, L2-normalised. Good enough to find near-paraphrases among a few
 * hundred answers when no embedding model is configured.
 */
export function hashedEmbedding(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  const words = tokenize(text);
  const features = [...words, ...words.slice(1).map((w, i) => `${words[i]} ${w}`)];
  for (const f of features) v[fnv1a(f) % DIMS] += 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity. Vectors from different embedding models (different lengths) never match. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
