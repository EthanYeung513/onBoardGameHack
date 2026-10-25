import type { Doc } from "../_generated/dataModel";

// Stage names, labels and the scan chain — shared by Convex (enqueueing the next stage), the
// worker (src/worker/registry.ts runs them) and the scan UI (shows the steps).

export type StageName = Doc<"jobs">["stage"];

export const STAGE_LABELS: Record<StageName, string> = {
  crawl: "Reading your website",
  extract_design: "Extracting brand identity",
  analyse: "Understanding your company",
  seed_brain: "Building company knowledge graph",
  generate_courses: "Drafting onboarding courses",
  sync_connector: "Syncing tool",
  cascade: "Updating what changed",
  deploy: "Deploying the onboarding world",
  ready: "Calibrating dashboard to your brand",
};

/** The scan the manager waits on: brand identity only → theme options (D-34, seconds not minutes). */
export const SCAN_CHAIN: StageName[] = ["extract_design", "ready"];
/** Started alongside the scan, never blocking it: reading the site, the brain and course drafts.
 * These jobs carry `sourceScanId` (not `scanId`), so their failures never fail the scan. */
export const ENRICH_CHAIN: StageName[] = ["crawl", "analyse", "seed_brain", "generate_courses"];

function nextIn(chain: StageName[], stage: StageName): StageName | null {
  const i = chain.indexOf(stage);
  return i >= 0 && i < chain.length - 1 ? chain[i + 1] : null;
}
export const nextInScan = (stage: StageName) => nextIn(SCAN_CHAIN, stage);
export const nextInEnrich = (stage: StageName) => nextIn(ENRICH_CHAIN, stage);

/** A running job with no heartbeat for this long is marked stalled (PRD success metrics). */
export const STALL_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export function backoffMs(attempt: number): number {
  return 2000 * 2 ** Math.max(0, attempt - 1);
}
