// Usage: npm run eval -- --label v1 [--model <mubit model id>] [--set eval/heldout.json] [--record]
// Grades the held-out set with one model and writes eval/results/<label>.json.
// --record also stores the metrics as a model version and applies the regression gate.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { acmePay } from "../content/acme-pay/world";
import { getDb } from "../src/db/client";
import { recordVersion } from "../src/eval/gate";
import { loadHeldOut, resolveItems } from "../src/eval/heldout";
import { runEval } from "../src/eval/run";
import { getLlm } from "../src/llm";
import { defaultModel } from "../src/llm/env";

const { values } = parseArgs({
  options: {
    label: { type: "string", default: "v0" },
    model: { type: "string" },
    set: { type: "string" },
    record: { type: "boolean", default: false },
  },
});

const llm = getLlm();
const model = values.model ?? defaultModel();
const { items, source, isExample } = loadHeldOut(process.cwd(), values.set);
if (isExample) console.warn("⚠ Using eval/heldout.example.json (placeholder labels). Put the manager's labels in eval/heldout.json.");

const report = await runEval(llm, model, values.label!, resolveItems(items, acmePay, path.join(process.cwd(), "content", "acme-pay")), source);
mkdirSync(path.join("eval", "results"), { recursive: true });
const out = path.join("eval", "results", `${values.label}.json`);
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

const m = report.metrics;
console.log(`${values.label} (${model}, ${llm.mode}) on ${m.n} items from ${source}`);
console.log(`  agreement ${(m.agreement * 100).toFixed(1)}%  within-1 ${(m.withinOne * 100).toFixed(1)}%  MAE ${m.mae.toFixed(2)}`);
console.log(`  cost/1k $${m.costPer1k.toFixed(3)}  p50 ${m.p50Ms}ms  p95 ${m.p95Ms}ms  failed ${m.failed}`);
console.log(`  wrote ${out}`);

if (values.record) {
  const { decision } = await recordVersion(await getDb(), "grade", values.label!, model, m);
  console.log(`  gate: ${decision.promote ? "PROMOTED" : "BLOCKED"} (${decision.reason})`);
}
process.exit(0);
