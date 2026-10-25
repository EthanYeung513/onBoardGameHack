import type { StageName } from "@convex/lib/stages";
import { readyStage } from "./stages/ready";
import type { StageDefinition } from "./types";

// Every worker stage is registered here. The worker only claims jobs for registered stages, so a
// stage that isn't built yet leaves its job queued (visible in the scan log), never faked.

export const registry: Partial<Record<StageName, StageDefinition>> = {
  ready: readyStage,
};

export const registeredStages = () => Object.keys(registry) as StageName[];
