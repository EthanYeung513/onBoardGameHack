import { safeMemory } from "@/lib/memory";
import type { StageDefinition } from "../types";

export const readyStage: StageDefinition = {
  name: "ready",
  label: "Ready",
  description: "Flows are ready to preview, edit and publish",
  maxAttempts: 1,
  async run(ctx) {
    const r = await safeMemory.reflect(ctx.project.id, "ready");
    await ctx.event("info", `Reflected on this project: ${r?.lessons.length ?? 0} lessons available across projects`);
    return { done: true, summary: "flows ready" };
  },
};
