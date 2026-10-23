import { and, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as t from "../db/schema";
import type { Metrics } from "./metrics";

export interface GateDecision {
  promote: boolean;
  reason: string;
}

/** The regression gate: a candidate is promoted only if its held-out agreement is at least the current version's. */
export function gateDecision(current: Pick<Metrics, "agreement"> | null, candidate: Pick<Metrics, "agreement" | "failed" | "n">): GateDecision {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  if (candidate.n === 0 || candidate.failed === candidate.n) return { promote: false, reason: "candidate failed every held-out item" };
  if (!current) return { promote: true, reason: `first measured version (${pct(candidate.agreement)} agreement)` };
  if (candidate.agreement >= current.agreement) {
    return { promote: true, reason: `agreement ${pct(candidate.agreement)} ≥ current ${pct(current.agreement)}` };
  }
  return { promote: false, reason: `agreement ${pct(candidate.agreement)} < current ${pct(current.agreement)}: blocked` };
}

/**
 * Records an eval run as a model version. If the label is the version already promoted (e.g. re-measuring v0),
 * its metrics are updated in place; otherwise the gate decides between promoted and blocked.
 */
export async function recordVersion(db: DB, task: string, label: string, model: string, metrics: Metrics) {
  const values = {
    heldOutAgreement: metrics.agreement,
    withinOne: metrics.withinOne,
    mae: metrics.mae,
    costPer1k: metrics.costPer1k,
    p50Ms: metrics.p50Ms,
    p95Ms: metrics.p95Ms,
  };
  const [current] = await db
    .select()
    .from(t.modelVersions)
    .where(and(eq(t.modelVersions.task, task), eq(t.modelVersions.status, "promoted")));

  if (current && current.label === label) {
    await db.update(t.modelVersions).set({ ...values, model }).where(eq(t.modelVersions.id, current.id));
    return { label, decision: { promote: true, reason: "re-measured the promoted version" } satisfies GateDecision };
  }

  const decision = gateDecision(current?.heldOutAgreement != null ? { agreement: current.heldOutAgreement } : null, metrics);
  if (decision.promote && current) await db.update(t.modelVersions).set({ status: "candidate" }).where(eq(t.modelVersions.id, current.id));
  await db.insert(t.modelVersions).values({ task, label, model, trainedAt: new Date(), ...values, status: decision.promote ? "promoted" : "blocked" });
  return { label, decision };
}
