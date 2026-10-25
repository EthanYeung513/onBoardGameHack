"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { courseMemoryFromEnv } from "../src/lib/courses/memory";
import { withTimeout } from "../src/lib/courses/switch";

// The Mubit memory calls of course learning (the SDK speaks gRPC, so Node only). Called by
// convex/courseAssist.ts; these never touch the database, they only talk to Mubit.

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export const recall = internalAction({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<string> => {
    const memory = courseMemoryFromEnv(process.env);
    return memory ? withTimeout(memory.recall(query), 6000, "Mubit recall") : "";
  },
});

export const remember = internalAction({
  args: { content: v.string(), metadata: v.record(v.string(), v.string()), referenceId: v.string(), success: v.boolean(), summary: v.string() },
  handler: async (_ctx, a): Promise<{ status: "remembered" | "skipped" | "failed"; detail: string }> => {
    const memory = courseMemoryFromEnv(process.env);
    if (!memory) return { status: "skipped", detail: "Mubit memory not enabled (MEMORY_PROVIDER≠mubit or no key)" };
    try {
      await withTimeout(memory.remember({ content: a.content, metadata: a.metadata }), 8000, "Mubit remember");
      await withTimeout(memory.recordOutcome({ referenceId: a.referenceId, success: a.success, summary: a.summary, metadata: a.metadata }), 8000, "Mubit recordOutcome");
      return { status: "remembered", detail: "remember + recordOutcome sent to Mubit memory (course-preferences agent)" };
    } catch (err) {
      return { status: "failed", detail: msg(err) };
    }
  },
});
