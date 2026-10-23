// Usage: npm run bulk-grade -- [--in eval/personas/answers.json] [--limit 150]
// Grades synthetic answers through Mubit (fills the grade task's kept examples and the review queue).
// PGlite is single-process: stop `npm run dev` first, or point DATABASE_URL at Neon.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { bulkGrade, type PersonaAnswer } from "../src/data/bulk";
import { closeDb, getDb } from "../src/db/client";
import { getLlm } from "../src/llm";

const { values } = parseArgs({
  options: {
    in: { type: "string", default: path.join("eval", "personas", "answers.json") },
    limit: { type: "string" },
  },
});
const all: PersonaAnswer[] = JSON.parse(readFileSync(values.in!, "utf8"));
const items = values.limit ? all.slice(0, Number(values.limit)) : all;
const llm = getLlm();
if (llm.mode === "offline") console.warn("⚠ No MUBIT_API_KEY: grading offline. Nothing reaches Mubit.");

const started = Date.now();
const { graded, failures } = await bulkGrade(await getDb(), llm, items);
console.log(`Graded ${graded}/${items.length} answers (${llm.mode}) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failures.length) console.log(`${failures.length} failures, first: ${failures[0]}`);
await closeDb();
process.exit(failures.length === items.length ? 1 : 0);
