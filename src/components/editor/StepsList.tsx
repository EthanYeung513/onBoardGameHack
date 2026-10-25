"use client";

import type { StaleSource } from "@convex/editor";
import { KIND_LABEL, type SpecStep } from "./Preview";

// editor.html left column (`renderSteps`), plus the F36 marker: a step whose taught facts went stale
// says which source changed and offers "Refresh step" (manager-confirmed regeneration).

const TOOL: Record<string, string> = {
  github: "GitHub",
  slack: "Slack",
  notion: "Notion",
  jira: "Jira",
  linear: "Linear",
  drive: "Drive",
  webapp: "Web app",
  files: "Files",
  website: "Website",
};

export function staleLine(sources: StaleSource[]): string {
  if (sources.length === 0) return "A source it cites changed";
  return sources.map((s) => `${TOOL[s.type] ?? s.type}: ${s.title}`).join(" · ");
}

type Props = {
  steps: SpecStep[];
  cur: number;
  stale: Record<string, StaleSource[]>;
  refreshing: Set<string>;
  onPick: (i: number) => void;
  onRefresh: (stepId: string) => void;
};

export function StepsList({ steps, cur, stale, refreshing, onPick, onRefresh }: Props) {
  return (
    <>
      {steps.map((s, i) => {
        const sources = stale[s.id];
        return (
          <div key={s.id} className={`step${i === cur ? " on" : ""}`} onClick={() => onPick(i)}>
            <span className="num">{i + 1}</span>
            <div>
              <div className="tt">{s.title}</div>
              <div className="ss">{KIND_LABEL[s.kind] ?? s.kind} · +20 XP</div>
              {sources && (
                <div className="stale" data-testid={`stale-${s.id}`}>
                  <span className="stale-pill">Needs refresh</span>
                  <span className="stale-src">{staleLine(sources)}</span>
                  <button
                    type="button"
                    className="stale-btn"
                    disabled={refreshing.has(s.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRefresh(s.id);
                    }}
                  >
                    {refreshing.has(s.id) ? "Refreshing…" : "Refresh step"}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
