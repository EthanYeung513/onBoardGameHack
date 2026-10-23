import { describe, expect, it } from "vitest";
import { acmePay } from "../content/acme-pay/world";
import * as t from "@/db/schema";
import { gateDecision, recordVersion } from "@/eval/gate";
import { loadHeldOut, resolveItems } from "@/eval/heldout";
import { computeMetrics, percentile } from "@/eval/metrics";
import { runEval } from "@/eval/run";
import { OfflineClient } from "@/llm/offline";
import { offlineGrade } from "@/tasks/offline-grade";
import { FakeLlm, contentDir, seededDb } from "./helpers";

describe("metrics", () => {
  it("computes agreement, within-1, MAE, cost and latency percentiles", () => {
    const m = computeMetrics([
      { id: "a", human: 3, predicted: 3, latencyMs: 100, costUsd: 0.001 },
      { id: "b", human: 0, predicted: 2, latencyMs: 200, costUsd: 0.001 },
      { id: "c", human: 1, predicted: 2, latencyMs: 300, costUsd: 0.001 },
      { id: "d", human: 2, predicted: null, latencyMs: 0, costUsd: 0, error: "x" },
    ]);
    expect(m.agreement).toBe(0.25);
    expect(m.withinOne).toBe(0.5);
    expect(m.mae).toBe((0 + 2 + 1 + 3) / 4);
    expect(m.failed).toBe(1);
    expect(m.costPer1k).toBeCloseTo(0.75);
    expect(percentile([100, 200, 300, 400], 50)).toBe(200);
    expect(percentile([100, 200, 300, 400], 95)).toBe(400);
  });
});

describe("held-out set", () => {
  it("loads the example set and resolves every item to a rubric with policy text", () => {
    const { items, isExample } = loadHeldOut();
    expect(isExample || items.length > 0).toBe(true);
    const resolved = resolveItems(items, acmePay, contentDir);
    expect(resolved.every((r) => r.input.rubric.policy.length > 20 && r.input.corrections.length === 0)).toBe(true);
    expect(() => resolveItems([{ id: "x", card: "No such card prompt", answer: "a", human: 1, labeller: "t" }], acmePay, contentDir)).toThrow(/no card/);
  });

  it("runs an eval end to end with the offline grader", async () => {
    const { items, source } = loadHeldOut();
    const report = await runEval(new OfflineClient({ grade: offlineGrade }), "offline-baseline", "v0", resolveItems(items, acmePay, contentDir), source);
    expect(report.metrics.n).toBe(items.length);
    expect(report.metrics.failed).toBe(0);
    expect(report.items.every((i) => i.predicted != null)).toBe(true);
  });

  it("counts invalid grader replies as failures instead of crashing", async () => {
    const { items, source } = loadHeldOut();
    const report = await runEval(new FakeLlm(["not json"]), "broken", "bad", resolveItems(items.slice(0, 2), acmePay, contentDir), source);
    expect(report.metrics.failed).toBe(2);
    expect(report.metrics.agreement).toBe(0);
  });
});

describe("regression gate", () => {
  const m = (agreement: number) => ({ n: 10, failed: 0, agreement, withinOne: 1, mae: 0.5, costPer1k: 1, p50Ms: 100, p95Ms: 200 });

  it("promotes an equal-or-better candidate and blocks a worse one", () => {
    expect(gateDecision(null, m(0.5)).promote).toBe(true);
    expect(gateDecision({ agreement: 0.6 }, m(0.6)).promote).toBe(true);
    expect(gateDecision({ agreement: 0.6 }, m(0.55))).toMatchObject({ promote: false, reason: expect.stringContaining("blocked") });
    expect(gateDecision(null, { n: 3, failed: 3, agreement: 0 }).promote).toBe(false);
  });

  it("records versions: re-measures v0, promotes v1, blocks a worse v2", async () => {
    const { db } = await seededDb();
    await recordVersion(db, "grade", "v0", "frontier", m(0.6));
    const v1 = await recordVersion(db, "grade", "v1", "adapter-1", m(0.8));
    const v2 = await recordVersion(db, "grade", "v2", "adapter-2", m(0.7));
    expect(v1.decision.promote).toBe(true);
    expect(v2.decision.promote).toBe(false);

    const rows = await db.select().from(t.modelVersions);
    const status = Object.fromEntries(rows.map((r) => [r.label, r.status]));
    expect(status).toEqual({ v0: "candidate", v1: "promoted", v2: "blocked" });
    expect(rows.find((r) => r.label === "v0")?.heldOutAgreement).toBeCloseTo(0.6);
  });
});
