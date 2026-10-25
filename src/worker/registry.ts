import type { StageName } from "@convex/lib/stages";
import { cascadeStage } from "./stages/cascade";
import { readyStage } from "./stages/ready";
import { seedBrainStage } from "./stages/seed-brain";
import { syncConnectorStage } from "./stages/sync_connector";
import type { StageDefinition } from "./types";

// Every worker stage is registered here. The worker only claims jobs for registered stages, so a
// stage that isn't built yet leaves its job queued (visible in the scan log), never faked.

export const registry: Partial<Record<StageName, StageDefinition>> = {
  seed_brain: seedBrainStage,
  cascade: cascadeStage,
  ready: readyStage,
  sync_connector: syncConnectorStage,
};

export const registeredStages = () => Object.keys(registry) as StageName[];
