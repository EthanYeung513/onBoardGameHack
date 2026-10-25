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
  ready: "Calibrating dashboard to your brand",
};

/** A space scan runs these in order (PRD "Subsystem: scan pipeline"). */
export const SCAN_CHAIN: StageName[] = ["crawl", "extract_design", "analyse", "seed_brain", "generate_courses", "ready"];

export function nextInScan(stage: StageName): StageName | null {
  const i = SCAN_CHAIN.indexOf(stage);
  return i >= 0 && i < SCAN_CHAIN.length - 1 ? SCAN_CHAIN[i + 1] : null;
}

/** A running job with no heartbeat for this long is marked stalled (PRD success metrics). */
export const STALL_MS = 60_000;
export const DEFAULT_MAX_ATTEMPTS = 3;

export function backoffMs(attempt: number): number {
  return 2000 * 2 ** Math.max(0, attempt - 1);
}
