"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { brandMemoryFromEnv, withTimeout } from "../src/lib/brand/memory";
import { getBrandFeedbackSink } from "../src/services/brand-feedback";

// The Mubit loop for one brand decision, scheduled by `brand.decide` so it never blocks the UI:
// 1. feedback on the `brand.recommend` call (approve / correct with corrected_output = chosen,
//    keyed by the Mubit request id), 2. Mubit memory remember + recordOutcome. Every outcome —
// delivered, skipped or failed — is written to the decision and audited; nothing is silent.

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export const send = internalAction({
  args: { decisionId: v.id("brand_decisions") },
  handler: async (ctx, { decisionId }) => {
    const d = await ctx.runQuery(internal.brand.loopContext, { decisionId });
    if (!d) return;
    const p = d.companyProfile;
    const sink = getBrandFeedbackSink(process.env);
    let feedback: { sink: string; delivered: boolean; detail: string };
    try {
      feedback = {
        sink: sink.name,
        ...(await sink.send({
          kind: d.accepted ? "approval" : "correction",
          task: "brand.recommend",
          requestId: d.mubitRequestId ?? null,
          field: d.field,
          recommended: d.recommended,
          chosen: d.chosen,
          host: p.host,
          category: p.category ?? p.industry,
          reviewer: d.actor,
        })),
      };
    } catch (err) {
      feedback = { sink: sink.name, delivered: false, detail: `failed: ${msg(err)}` };
    }

    const memory = brandMemoryFromEnv(process.env);
    let mem: { status: "remembered" | "skipped" | "failed"; detail: string };
    if (!memory) mem = { status: "skipped", detail: "Mubit memory not enabled (MEMORY_PROVIDER≠mubit or no key)" };
    else {
      const metadata = { field: d.field, host: p.host, category: p.category ?? p.industry ?? "unknown", source: d.recommendedSource };
      try {
        await withTimeout(
          memory.remember({
            content: `${p.host}${p.category ? ` (${p.category})` : ""} chose ${d.chosen} as ${d.field}${d.accepted ? " — the recommendation" : ` over the recommended ${d.recommended}`}. Palette: ${p.paletteSummary}`,
            metadata,
          }),
          8000,
          "Mubit remember",
        );
        await withTimeout(
          memory.recordOutcome({ referenceId: d.mubitRequestId ?? String(decisionId), success: d.accepted, summary: `${d.field} recommendation ${d.accepted ? "accepted" : "corrected"} for ${p.host}`, metadata }),
          8000,
          "Mubit recordOutcome",
        );
        mem = { status: "remembered", detail: "remember + recordOutcome sent to Mubit memory" };
      } catch (err) {
        mem = { status: "failed", detail: msg(err) };
      }
    }
    await ctx.runMutation(internal.brand.recordLoop, { decisionId, feedback, memory: mem });
  },
});
