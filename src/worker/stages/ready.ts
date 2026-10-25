import type { StageDefinition } from "../types";

/** Last scan stage: the dashboard unlocks (convex/pipeline.finish marks scan + space ready). */
export const readyStage: StageDefinition = {
  name: "ready",
  async run(ctx) {
    await ctx.event("info", `${ctx.space.name} is ready`);
    return { done: true, summary: "dashboard calibrated to your brand" };
  },
};
