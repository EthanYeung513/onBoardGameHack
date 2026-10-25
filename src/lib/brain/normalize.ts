// Normalisation shared by the extractor (worker) and the brain writes (Convex): hard keys for
// entity resolution (F15) and the fact dedupe key. Pure functions, no runtime dependencies.

export function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[`'"’*_]/g, "")
    .replace(/[^a-z0-9@.#+&/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
}

/** Fact dedupe key: case, punctuation and spacing don't make a different fact. */
export function factKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9£$€%]+/g, " ")
    .trim();
}

export interface KeyedEntity {
  name: string;
  aliases?: string[];
  keys?: { email?: string; login?: string; url?: string };
}

/** Hard keys, strongest first: email → login → URL → names. `entities.key` stores the first. */
export function hardKeys(e: KeyedEntity): string[] {
  const out: string[] = [];
  const k = e.keys ?? {};
  if (k.email?.includes("@")) out.push(`email:${k.email.trim().toLowerCase()}`);
  if (k.login) out.push(`login:${k.login.trim().toLowerCase().replace(/^@/, "")}`);
  if (k.url) out.push(`url:${normUrl(k.url)}`);
  for (const n of [e.name, ...(e.aliases ?? [])]) {
    const nn = normName(n);
    if (nn) out.push(`name:${nn}`);
  }
  return [...new Set(out)];
}

/** Token Jaccard of two names, for the offline adjudication stand-in. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normName(a).split(" ").filter(Boolean));
  const tb = new Set(normName(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / new Set([...ta, ...tb]).size;
}
