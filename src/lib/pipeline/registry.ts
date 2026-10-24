import { STAGES, type StageDefinition, type StageName } from "./types";
import { crawlStage } from "./stages/crawl";
import { extractDesignStage } from "./stages/extract-design";
import { analyseStage } from "./stages/analyse";
import { askQuestionsStage } from "./stages/ask-questions";
import { generateFlowsStage } from "./stages/generate-flows";
import { validateStage } from "./stages/validate";
import { readyStage } from "./stages/ready";

// Every pipeline stage is registered here. Adding a stage means writing its definition and
// placing it in ORDER; existing stages do not change.

const waitFor = (name: StageName, label: string, description: string): StageDefinition => ({
  name,
  label,
  description,
  maxAttempts: 1,
  waitsForUser: true,
  run: async () => ({ wait: true }),
});

export const registry: Record<StageName, StageDefinition> = {
  crawl: crawlStage,
  extract_design: extractDesignStage,
  analyse: analyseStage,
  awaiting_confirmation: waitFor("awaiting_confirmation", "Review findings", "Waiting for you to review and confirm what was found"),
  ask_questions: askQuestionsStage,
  awaiting_answers: waitFor("awaiting_answers", "Answer questions", "Waiting for your answers"),
  generate_flows: generateFlowsStage,
  validate: validateStage,
  ready: readyStage,
};

export const ORDER: StageName[] = [...STAGES];

export function stage(name: StageName): StageDefinition {
  const s = registry[name];
  if (!s) throw new Error(`Unknown stage ${name}`);
  return s;
}

export function nextStage(name: StageName): StageName | null {
  const i = ORDER.indexOf(name);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
}
