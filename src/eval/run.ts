import type { LlmClient } from "../llm/types";
import { gradeAnswer } from "../tasks/grade";
import type { ResolvedItem } from "./heldout";
import { computeMetrics, type ItemResult, type Metrics } from "./metrics";

export interface EvalReport {
  label: string;
  model: string;
  mode: LlmClient["mode"];
  source: string;
  ranAt: string;
  metrics: Metrics;
  items: ItemResult[];
}

/** Grades every held-out item with one model (no retrieved rulings: this measures the model itself). */
export async function runEval(llm: LlmClient, model: string, label: string, items: ResolvedItem[], source: string, concurrency = 4): Promise<EvalReport> {
  const results: ItemResult[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      try {
        const { grade, call } = await gradeAnswer(llm, model, item.input);
        results[i] = { id: item.id, human: item.human, predicted: grade.scores[item.input.rubric.competency] ?? null, latencyMs: call.latencyMs, costUsd: call.costUsd };
      } catch (err) {
        results[i] = { id: item.id, human: item.human, predicted: null, latencyMs: 0, costUsd: 0, error: (err as Error).message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { label, model, mode: llm.mode, source, ranAt: new Date().toISOString(), metrics: computeMetrics(results), items: results };
}
