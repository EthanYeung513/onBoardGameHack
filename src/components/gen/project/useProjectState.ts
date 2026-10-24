"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectState } from "@/lib/pipeline/state";
import { supabaseBrowser } from "@/lib/supabase/browser";

const KICK_AFTER_MS = 15_000;

/**
 * Live project state. Realtime changes on jobs, job_events and projects trigger a refetch; a slow
 * poll covers dropped connections. If a stage is queued and nothing has touched it for a while,
 * the page asks the server to continue, so the pipeline never waits silently.
 */
export function useProjectState(projectId: string, initial: ProjectState) {
  const [state, setState] = useState(initial);
  const [live, setLive] = useState(false);
  const lastKick = useRef(0);

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/gen/projects/${projectId}/state`, { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, [projectId]);

  useEffect(() => {
    const sb = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    const channel = sb
      .channel(`project-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter: `project_id=eq.${projectId}` }, soon)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "job_events", filter: `project_id=eq.${projectId}` }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects", filter: `id=eq.${projectId}` }, soon)
      .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
    const poll = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      void sb.removeChannel(channel);
    };
  }, [projectId, refresh]);

  useEffect(() => {
    const job = state.jobs.find((j) => j.stage === state.project.stage);
    if (!job || job.status !== "queued") return;
    const last = Math.max(job.heartbeat_at ? Date.parse(job.heartbeat_at) : 0, Date.parse(job.created_at));
    const retryAt = typeof job.cursor?.retry_at === "string" ? Date.parse(job.cursor.retry_at) : 0;
    const due = Math.max(last + KICK_AFTER_MS, retryAt);
    const wait = Math.max(0, due - Date.now(), lastKick.current + KICK_AFTER_MS - Date.now());
    const t = setTimeout(() => {
      lastKick.current = Date.now();
      void fetch(`/api/gen/pipeline/${projectId}/advance`, { method: "POST" });
    }, wait);
    return () => clearTimeout(t);
  }, [state, projectId]);

  return { state, refresh, live };
}
