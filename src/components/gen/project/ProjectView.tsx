"use client";
import type { ProjectState } from "@/lib/pipeline/state";
import { useState } from "react";
import { ChatTab } from "./ChatTab";
import { FilesTab } from "./FilesTab";
import { Findings } from "./Findings";
import { MemoryTab } from "./MemoryTab";
import { Flows } from "./Flows";
import { Questions } from "./Questions";
import { Timeline } from "./Timeline";
import { useProjectState } from "./useProjectState";

const ORDER = ["crawl", "extract_design", "analyse", "awaiting_confirmation", "ask_questions", "awaiting_answers", "generate_flows", "validate", "ready"];

export function ProjectView({ initial }: { initial: ProjectState }) {
  const { state, refresh, live } = useProjectState(initial.project.id, initial);
  const at = ORDER.indexOf(state.project.stage);
  const past = (s: string) => at > ORDER.indexOf(s);
  const [bump, setBump] = useState(0);
  const changed = () => {
    setBump((b) => b + 1);
    void refresh();
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold">{state.project.name ?? new URL(state.project.url).hostname}</h1>
        <a href={state.project.url} target="_blank" rel="noreferrer" className="g-muted text-sm hover:underline">
          {state.project.url}
        </a>
      </div>
      <Timeline
        state={state}
        live={live}
        onResume={async () => {
          await fetch(`/api/gen/projects/${state.project.id}/resume`, { method: "POST" });
          await refresh();
        }}
      />
      {state.flows.length > 0 && past("generate_flows") && <Flows
          state={state}
          renderTab={(tab, flow) =>
            tab === "files" ? <FilesTab flowId={flow.id} bump={bump} onChanged={changed} /> : tab === "chat" ? <ChatTab flowId={flow.id} bump={bump} onChanged={changed} /> : <MemoryTab projectId={state.project.id} bump={bump} />
          }
        />}
      {state.questions.length > 0 && (state.project.stage === "awaiting_answers" || past("awaiting_answers")) && (
        <Questions key={state.answers.length} state={state} editable={state.project.stage === "awaiting_answers"} onSaved={refresh} />
      )}
      {state.model && (state.project.stage === "awaiting_confirmation" || past("awaiting_confirmation")) && (
        <Findings key={state.model.id} state={state} editable={state.project.stage === "awaiting_confirmation"} onConfirmed={refresh} />
      )}
    </div>
  );
}
