import { createHash } from "node:crypto";

// Normalised text → ~`target`-token chunks split on headings, then paragraphs, then sentences.
// Token counts are estimated at 4 chars/token (good enough for budgeting, no tokenizer dep).

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function contentHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex");
}

function splitLong(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const sentences = block.match(/[^.!?\n]+[.!?]*\s*/g) ?? [block];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (cur) out.push(cur);
      cur = "";
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
      continue;
    }
    if ((cur + s).length > maxChars && cur) {
      out.push(cur);
      cur = "";
    }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}

export function chunkText(text: string, target = 500): { idx: number; text: string; tokens: number }[] {
  const maxChars = target * 4;
  const clean = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  // Sections start at markdown headings so a chunk rarely straddles two topics.
  const sections = clean.split(/\n(?=#{1,6}\s)/);
  const pieces = sections.flatMap((sec) => sec.split(/\n\n+/)).flatMap((p) => splitLong(p.trim(), maxChars)).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of pieces) {
    const startsSection = /^#{1,6}\s/.test(p);
    if (cur && ((cur + "\n\n" + p).length > maxChars || (startsSection && cur.length > maxChars / 3))) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((t, idx) => ({ idx, text: t, tokens: estimateTokens(t) }));
}
