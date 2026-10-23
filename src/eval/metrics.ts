export interface ItemResult {
  id: string;
  human: number;
  predicted: number | null;
  latencyMs: number;
  costUsd: number;
  error?: string;
}

export interface Metrics {
  n: number;
  failed: number;
  agreement: number;
  withinOne: number;
  mae: number;
  costPer1k: number;
  p50Ms: number;
  p95Ms: number;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Agreement with the manager's labels. A failed call counts as a disagreement (and an error of 3) so a version
 * can't look better by failing on hard items.
 */
export function computeMetrics(results: ItemResult[]): Metrics {
  const diffs = results.map((r) => (r.predicted == null ? 3 : Math.abs(r.predicted - r.human)));
  return {
    n: results.length,
    failed: results.filter((r) => r.predicted == null).length,
    agreement: mean(diffs.map((d) => (d === 0 ? 1 : 0))),
    withinOne: mean(diffs.map((d) => (d <= 1 ? 1 : 0))),
    mae: mean(diffs),
    costPer1k: mean(results.map((r) => r.costUsd)) * 1000,
    p50Ms: percentile(results.map((r) => r.latencyMs), 50),
    p95Ms: percentile(results.map((r) => r.latencyMs), 95),
  };
}
