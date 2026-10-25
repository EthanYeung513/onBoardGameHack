// `npm run eval:brand` — does learning from Design-tab decisions make the recommended brand option
// right the first time? Replays manager decisions recorded against real sites' extracted candidates
// (cases/brand/*.json; record more with `npm run eval:brand:record -- <url> <category>`).
//
//   cold       no history: the heuristic (what extract_design picked before S19)
//   new co.    leave-one-out: learn from every OTHER company's decisions, recommend for the held-out one
//   returning  the company's own earlier decisions are in the history (a re-scan / second space)
//
// With MUBIT_API_KEY set (and not OFFLINE=1 / --offline) the same protocol also runs the real
// `brand.recommend` task through the Mubit adapter (cold vs with precedents) and Mubit embeddings
// for precedent search; otherwise every number is labelled OFFLINE.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mubitConfigFromEnv } from "@/llm/env";
import { buildDecision, toRecord } from "@/lib/brand/decision";
import { computeRecommendation } from "@/lib/brand/recommend";
import { sameValue } from "@/lib/brand/ranker";
import { BRAND_FIELDS, type BrandField, type DecisionRecord, type StoredRecommendation } from "@/lib/brand/types";
import { createEmbedder, type Embedder } from "@/worker/providers/embed";
import { createLlm, type Llm } from "@/worker/providers/llm";

interface Case {
  host: string;
  name?: string;
  category?: string;
  candidates: unknown;
  decisions: Record<BrandField, string>;
}

const offlineFlag = process.argv.includes("--offline");
const live = !offlineFlag && Boolean(mubitConfigFromEnv());
const dir = "cases/brand";
const cases: Case[] = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as Case)
  .filter((c) => c.decisions && BRAND_FIELDS.every((f) => c.decisions[f]));

const offlineLlm: Llm = { live: false, json: async () => Promise.reject(new Error("offline")) };
const baseEmbed = live ? createEmbedder() : createEmbedder(undefined);
const memo = new Map<string, number[]>();
const embed: Embedder = {
  mode: live ? baseEmbed.mode : "offline",
  async embed(texts) {
    const missing = texts.filter((t) => !memo.has(t));
    if (missing.length) (await baseEmbed.embed(missing)).forEach((v, i) => memo.set(missing[i], v));
    return texts.map((t) => memo.get(t)!);
  },
};
const llm = live ? createLlm() : offlineLlm;

const profileOf = (c: Case) => ({ host: c.host, name: c.name, category: c.category });
const recommend = (c: Case, history: DecisionRecord[], model: Llm) =>
  computeRecommendation({ llm: model, embed, history: async () => history, log: async (lvl, m) => void (lvl === "warn" && console.warn(`  [${c.host}] ${m}`)) }, c.candidates, profileOf(c));

type Score = Record<BrandField, number>;
const zero = (): Score => ({ primary: 0, accent: 0, radius: 0, headline: 0 });
function hits(rec: StoredRecommendation, c: Case, into: Score) {
  for (const f of BRAND_FIELDS) if (sameValue(f, rec.fields[f].recommended, c.decisions[f])) into[f]++;
}
const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`.padStart(5);
const total = (s: Score) => BRAND_FIELDS.reduce((a, f) => a + s[f], 0);

async function main() {
  if (cases.length < 3) throw new Error(`need ≥3 labelled cases in ${dir}, found ${cases.length}`);
  console.log(`Brand replay: ${cases.length} companies × ${BRAND_FIELDS.length} fields — ${live ? "LIVE (Mubit brand.recommend + Mubit embeddings)" : "OFFLINE (learned ranker; hashed embeddings — no Mubit call)"}`);

  // Every company's decisions, as `brand.decide` would store them after its cold recommendation.
  const cold = new Map<string, StoredRecommendation>();
  const records = new Map<string, DecisionRecord[]>();
  for (const c of cases) {
    const rec = await recommend(c, [], offlineLlm);
    cold.set(c.host, rec);
    records.set(c.host, BRAND_FIELDS.map((f) => toRecord(rec, buildDecision(rec, f, c.decisions[f]))));
  }

  const rows: Record<string, Score> = { "cold (heuristic)": zero(), "new company (learned, LOO)": zero(), "returning company (learned)": zero() };
  if (live) Object.assign(rows, { "cold (Mubit, no precedents)": zero(), "new company (Mubit + precedents, LOO)": zero() });
  const perCase: Record<string, Record<string, Record<BrandField, string>>> = {};

  for (const c of cases) {
    const others = cases.filter((o) => o.host !== c.host).flatMap((o) => records.get(o.host)!);
    const own = records.get(c.host)!;
    const runs: [string, StoredRecommendation][] = [
      ["cold (heuristic)", cold.get(c.host)!],
      ["new company (learned, LOO)", await recommend(c, others, offlineLlm)],
      ["returning company (learned)", await recommend(c, [...others, ...own], offlineLlm)],
    ];
    if (live) {
      runs.push(["cold (Mubit, no precedents)", await recommend(c, [], llm)]);
      runs.push(["new company (Mubit + precedents, LOO)", await recommend(c, others, llm)]);
    }
    perCase[c.host] = { chosen: c.decisions };
    for (const [name, rec] of runs) {
      hits(rec, c, rows[name]);
      perCase[c.host][name] = Object.fromEntries(BRAND_FIELDS.map((f) => [f, `${rec.fields[f].recommended} [${rec.fields[f].source}]`])) as Record<BrandField, string>;
      if (rec.requestId) perCase[c.host][`${name} requestId`] = { primary: rec.requestId } as Record<BrandField, string>;
    }
    process.stdout.write(".");
  }
  console.log("\n\nFirst-time-right rate (recommended option = the manager's pick)");
  console.log(`${"".padEnd(40)}${BRAND_FIELDS.map((f) => f.padStart(9)).join("")}  overall`);
  for (const [name, s] of Object.entries(rows)) console.log(`${name.padEnd(40)}${BRAND_FIELDS.map((f) => pct(s[f], cases.length).padStart(9)).join("")}  ${pct(total(s), cases.length * BRAND_FIELDS.length)}`);

  const out = {
    ranAt: new Date().toISOString(),
    mode: live ? "live" : "offline",
    companies: cases.map((c) => c.host),
    firstTimeRight: Object.fromEntries(Object.entries(rows).map(([k, s]) => [k, { ...Object.fromEntries(BRAND_FIELDS.map((f) => [f, s[f] / cases.length])), overall: total(s) / (cases.length * BRAND_FIELDS.length) }])),
    perCase,
  };
  const file = `${dir}/_results-${out.mode}.json`;
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
