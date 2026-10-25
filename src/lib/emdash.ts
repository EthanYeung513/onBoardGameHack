// Product rule (Nicole): any text with an em-dash keeps only what comes before it.
// "Welcome — your journey starts" → "Welcome". Applied where copy is written: model output
// (worker llm.json), pipeline events and errors, extracted names, and the app's own UI strings.
// Pure, no imports: Convex bundles it too.

const EM_DASH = "—";

/** Text before the first em-dash, trimmed. A string that *starts* with one keeps what follows it
 * (rather than becoming empty), applied again until no em-dash is left. */
export function stripEmDash(text: string): string {
  const i = text.indexOf(EM_DASH);
  if (i < 0) return text;
  const before = text.slice(0, i).trimEnd();
  if (before.trim()) return before.replace(/[\s,;:(]+$/, "");
  return stripEmDash(text.slice(i + 1).trimStart());
}

/** stripEmDash on every string inside a JSON-like value (model output). */
export function stripEmDashDeep<T>(value: T): T {
  if (typeof value === "string") return stripEmDash(value) as T;
  if (Array.isArray(value)) return value.map(stripEmDashDeep) as T;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripEmDashDeep(v)])) as T;
  }
  return value;
}
