"use client";
import { useEffect, useMemo, useState } from "react";
import { StageTrack } from "@/components/gen/shell/StageTrack";
import { STAGE_LABELS } from "@/lib/pipeline/labels";
import type { ProjectState } from "@/lib/pipeline/state";

type Job = ProjectState["jobs"][number];
type Event = ProjectState["events"][number];

const LEVEL_COLOR: Record<string, string> = { info: "var(--g-ink)", warn: "var(--g-marigold-deep)", error: "var(--g-danger)", debug: "var(--g-slate)" };

function trackStates(state: ProjectState) {
  const out: Record<string, "done" | "active" | "waiting" | "failed" | "stalled" | "todo"> = {};
  const idx = STAGE_LABELS.findIndex((s) => s.key === state.project.stage);
  STAGE_LABELS.forEach((s, i) => {
    const job = state.jobs.find((j: Job) => j.stage === s.key);
    if (i < idx || job?.status === "succeeded") out[s.key] = "done";
    else if (i === idx) out[s.key] = job?.status === "failed" ? "failed" : job?.status === "stalled" ? "stalled" : job?.status === "waiting" ? "waiting" : "active";
  });
  return out;
}

export function Timeline({ state, live, onResume }: { state: ProjectState; live: boolean; onResume: () => Promise<void> }) {
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.parse(state.project.updated_at ?? state.project.created_at));
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const job = state.jobs.find((j: Job) => j.stage === state.project.stage);
  const stage = STAGE_LABELS.find((s) => s.key === state.project.stage);
  const events = useMemo(() => (showAll ? state.events : state.events.slice(-14)), [state.events, showAll]);
  const beatAge = job?.heartbeat_at ? Math.round(Math.max(0, now - Date.parse(job.heartbeat_at)) / 1000) : null;
  const blocked = job?.status === "failed" || job?.status === "stalled";

  return (
    <section className="g-panel space-y-5 p-5" aria-labelledby="timeline-h" data-testid="timeline">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="timeline-h" className="text-lg font-bold">
          {stage?.label}
        </h2>
        <span className="text-sm" data-testid="job-status" data-status={job?.status}>
          {job?.status === "running" && `Working, ${Math.round((job.progress ?? 0) * 100)}%`}
          {job?.status === "queued" && (job.attempt > 0 ? `Retrying (attempt ${job.attempt + 1})` : "Queued")}
          {job?.status === "waiting" && "Waiting for you"}
          {job?.status === "failed" && "Failed"}
          {job?.status === "stalled" && "Stalled"}
          {job?.status === "succeeded" && "Done"}
        </span>
        {job?.status === "running" && beatAge !== null && <span className="g-muted text-xs">heartbeat {beatAge}s ago</span>}
        <span className="g-muted ml-auto text-xs">{live ? "Live updates on" : "Polling for updates"}</span>
      </div>
      <StageTrack states={trackStates(state)} />
      {job?.status === "running" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--g-canvas)" }}>
          <div className="h-full transition-all" style={{ width: `${Math.max(4, (job.progress ?? 0) * 100)}%`, background: "var(--g-marigold)" }} />
        </div>
      )}
      {blocked && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg p-3 text-sm" style={{ background: "#fdecea", border: "1px solid var(--g-danger)" }}>
          <span className="min-w-0 flex-1">{job?.error ?? "This stage stopped."}</span>
          <button
            className="g-btn py-1.5 text-sm"
            disabled={busy}
            data-testid="resume-button"
            onClick={async () => {
              setBusy(true);
              await onResume();
              setBusy(false);
            }}
          >
            {job?.status === "failed" ? "Retry" : "Resume"}
          </button>
        </div>
      )}
      <ol className="max-h-80 space-y-1 overflow-y-auto font-[450] text-sm" aria-live="polite" data-testid="event-list">
        {events.map((e: Event) => (
          <li key={e.id} className="flex gap-3">
            <time className="g-muted w-20 shrink-0 tabular-nums">{new Date(e.created_at).toLocaleTimeString()}</time>
            <span style={{ color: LEVEL_COLOR[e.level] }}>{e.message}</span>
          </li>
        ))}
        {events.length === 0 && <li className="g-muted">Starting up.</li>}
      </ol>
      {state.events.length > 14 && (
        <button className="g-muted text-sm underline underline-offset-4" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show recent events" : `Show all ${state.events.length} events`}
        </button>
      )}
    </section>
  );
}
