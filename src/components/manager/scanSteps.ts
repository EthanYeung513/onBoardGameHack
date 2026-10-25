import { SCAN_CHAIN, STAGE_LABELS, type StageName } from "@convex/lib/stages";

// space.html step 3: the mockup's SCAN_STEPS lines, each lit by the real pipeline state from
// `api.pipeline.scanStatus` instead of a timer. Pure so the mapping is tested without Convex.

type JobStatus = "queued" | "running" | "succeeded" | "failed" | "stalled";

export type ScanJob = {
  id: string;
  stage: StageName;
  status: JobStatus;
  progress: number;
  attempt: number;
  error: string | null;
  queuedAt: number;
  startedAt: number | null;
};

export type ScanEvent = {
  id: string;
  at: number;
  stage: StageName;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  pages: number | null;
};

export type ScanInput = {
  scan: { status: "running" | "succeeded" | "failed"; progress: number; pageCount: number; error?: string };
  jobs: ScanJob[];
  events: ScanEvent[];
  stalled: boolean;
};

export type StepState = "done" | "active" | "";
export type NoteKind = "log" | "warn" | "error" | "stalled" | "waiting";
export type ScanStep = { key: string; text: string; state: StepState; note: { kind: NoteKind; text: string } | null };
export type ScanPhase = "running" | "retrying" | "waiting" | "stalled" | "failed" | "succeeded";
export type ScanView = {
  steps: ScanStep[];
  /** 0..1, drives the bar width. */
  progress: number;
  phase: ScanPhase;
  /** The failed/stalled job the Retry/Resume button acts on (only when `pipeline.resume` accepts it). */
  resumeJobId: string | null;
};

/** A queued job that no worker has started after this long gets an honest "waiting" line. */
export const WAITING_MS = 20_000;

type Line = { key: string; stages: StageName[]; text: (host: string, pages: number | null) => string };

// Mockup copy, in mockup order. "Reading public pages" is lit by `analyse`, the stage that reads
// the crawled pages, so the lines light top to bottom exactly as the mockup animates them.
const LINES: Line[] = [
  { key: "resolve", stages: ["crawl"], text: (host) => `Resolving ${host}` },
  { key: "sitemap", stages: ["crawl"], text: (_h, pages) => `Found ${pages ?? "…"} pages via sitemap.xml` },
  { key: "brand", stages: ["extract_design"], text: () => "Extracting brand identity (logo, colors, typography)" },
  { key: "read", stages: ["analyse"], text: () => "Reading public pages — about, careers, blog" },
  { key: "brain", stages: ["seed_brain"], text: () => "Building company knowledge graph" },
  { key: "calibrate", stages: ["generate_courses", "ready"], text: () => "Calibrating dashboard to your brand" },
];

/** The newest job per stage (a resumed or re-enqueued stage keeps only its latest attempt). */
function latestJobs(jobs: ScanJob[]): Partial<Record<StageName, ScanJob>> {
  const out: Partial<Record<StageName, ScanJob>> = {};
  for (const j of jobs) if (!out[j.stage] || out[j.stage]!.queuedAt <= j.queuedAt) out[j.stage] = j;
  return out;
}

function pageCount(input: ScanInput): number | null {
  if (input.scan.pageCount > 0) return input.scan.pageCount;
  for (let i = input.events.length - 1; i >= 0; i--) {
    const e = input.events[i];
    if (e.stage === "crawl" && e.pages !== null && e.pages > 0) return e.pages;
  }
  return null;
}

function lastEvent(events: ScanEvent[], stage: StageName, levels: ScanEvent["level"][]): ScanEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].stage === stage && levels.includes(events[i].level)) return events[i];
  return undefined;
}

export function scanView(input: ScanInput, host: string, now: number): ScanView {
  const byStage = latestJobs(input.jobs);
  const pages = pageCount(input);
  const ok = (s: StageName) => byStage[s]?.status === "succeeded";
  const crawl = byStage.crawl;
  const succeeded = input.scan.status === "succeeded";

  const done = LINES.map((line) => {
    if (succeeded) return true;
    if (line.key === "resolve") return !!crawl && (ok("crawl") || (crawl.startedAt !== null && (pages !== null || crawl.progress > 0)));
    return line.stages.every(ok);
  });
  const activeIndex = succeeded ? -1 : done.findIndex((d) => !d);

  let phase: ScanPhase = succeeded ? "succeeded" : "running";
  let resumeJobId: string | null = null;
  let note: ScanStep["note"] = null;

  if (activeIndex >= 0) {
    const line = LINES[activeIndex];
    const job = line.stages.map((s) => byStage[s]).find((j) => j && j.status !== "succeeded");
    if (job) {
      const label = STAGE_LABELS[job.stage];
      if (job.status === "failed") {
        phase = "failed";
        resumeJobId = job.id;
        note = { kind: "error", text: job.error ?? input.scan.error ?? `${label} failed` };
      } else if (job.status === "stalled" || (job.status === "running" && input.stalled)) {
        phase = "stalled";
        resumeJobId = job.status === "stalled" ? job.id : null;
        note = { kind: "stalled", text: `${label} stalled: no heartbeat for over 60 seconds.` };
      } else if (job.status === "queued" && job.attempt > 0) {
        phase = "retrying";
        const warn = lastEvent(input.events, job.stage, ["warn"]);
        note = { kind: "warn", text: warn?.message ?? `${label} failed, retrying: ${job.error ?? "unknown error"}` };
      } else if (job.status === "queued" && job.startedAt === null && now - job.queuedAt > WAITING_MS) {
        phase = "waiting";
        note = { kind: "waiting", text: `Waiting for the “${label}” step — no worker has picked it up yet.` };
      } else {
        const log = lastEvent(input.events, job.stage, ["info", "warn"]);
        if (log) note = { kind: "log", text: log.message };
      }
    }
  }
  if (input.scan.status === "failed" && phase !== "failed") {
    phase = "failed";
    const failed = input.jobs.find((j) => j.status === "failed");
    resumeJobId = failed?.id ?? null;
    if (!note || note.kind !== "error") note = { kind: "error", text: input.scan.error ?? "The scan failed." };
  }

  const steps: ScanStep[] = LINES.map((line, i) => ({
    key: line.key,
    text: line.text(host, pages),
    state: done[i] && (activeIndex < 0 || i < activeIndex) ? "done" : i === activeIndex ? "active" : "",
    note: i === activeIndex || (activeIndex < 0 && i === LINES.length - 1 && note) ? note : null,
  }));

  return { steps, progress: succeeded ? 1 : progressOf(input, byStage), phase, resumeJobId };
}

function progressOf(input: ScanInput, byStage: Partial<Record<StageName, ScanJob>>): number {
  let sum = 0;
  for (const stage of SCAN_CHAIN) {
    const j = byStage[stage];
    if (!j) continue;
    sum += j.status === "succeeded" ? 1 : Math.max(0, Math.min(1, j.progress));
  }
  return Math.min(1, Math.max(input.scan.progress, sum / SCAN_CHAIN.length));
}
