import type { StageName } from "@convex/lib/stages";
import { analyseStage } from "./stages/analyse";
import { cascadeStage } from "./stages/cascade";
import { crawlStage } from "./stages/crawl";
import { extractDesignStage } from "./stages/extract-design";
import { deployStage } from "./stages/deploy";
import { readyStage } from "./stages/ready";
import { seedBrainStage } from "./stages/seed-brain";
import { syncConnectorStage } from "./stages/sync_connector";
import type { StageDefinition } from "./types";

// Every worker stage is registered here. The worker only claims jobs for registered stages, so a
// stage that isn't built yet leaves its job queued (visible in the scan log), never faked.

export const registry: Partial<Record<StageName, StageDefinition>> = {
  crawl: crawlStage,
  extract_design: extractDesignStage,
  analyse: analyseStage,
  seed_brain: seedBrainStage,
  cascade: cascadeStage,
  deploy: deployStage,
  ready: readyStage,
  sync_connector: syncConnectorStage,
};

export const registeredStages = () => Object.keys(registry) as StageName[];
