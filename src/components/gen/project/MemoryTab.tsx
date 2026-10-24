"use client";
import { useEffect, useState } from "react";

interface MemoryData {
  provider: string;
  events: Array<{ id: number; operation: string; scope: string; payload_summary: string; ok: boolean; latency_ms: number; error: string | null; created_at: string }>;
  items: Array<{ id: string; kind: string; agent_id: string; content: string; source_url: string | null; created_at: string }>;
  lessons: Array<{ id: string; content: string }>;
}

export function MemoryTab({ projectId, bump }: { projectId: string; bump: unknown }) {
  const [data, setData] = useState<MemoryData | null>(null);
  useEffect(() => {
    void fetch(`/api/gen/projects/${projectId}/memory`, { cache: "no-store" }).then(async (r) => r.ok && setData(await r.json()));
  }, [projectId, bump]);
  if (!data) return <p className="g-muted">Loading memory.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="memory-tab">
      <section className="g-panel p-4">
        <h3 className="font-semibold">Calls</h3>
        <p className="g-muted mb-3 text-xs">
          Every memory read and write for this project. Store: {data.provider === "supabase" ? "Supabase (the Mubit memory API is not enabled for this key)" : "Mubit"}.
        </p>
        <ol className="max-h-[480px] space-y-2 overflow-y-auto text-sm" data-testid="memory-events">
          {data.events.map((e) => (
            <li key={e.id} className="border-b pb-2" style={{ borderColor: "var(--g-line)" }}>
              <div className="flex gap-2">
                <span className="font-semibold">{e.operation}</span>
                <span className="g-muted">{e.scope}</span>
                <span className="ml-auto text-xs" style={{ color: e.ok ? "var(--g-ok)" : "var(--g-danger)" }}>
                  {e.ok ? `${e.latency_ms} ms` : "failed"}
                </span>
              </div>
              <p className="g-muted text-xs">{e.error ?? e.payload_summary}</p>
            </li>
          ))}
          {data.events.length === 0 && <li className="g-muted">Nothing stored yet.</li>}
        </ol>
      </section>
      <section className="g-panel p-4">
        <h3 className="mb-3 font-semibold">What is remembered</h3>
        <ol className="max-h-[480px] space-y-2 overflow-y-auto text-sm">
          {data.items.map((i) => (
            <li key={i.id}>
              <span className="mr-2 rounded px-1.5 py-0.5 text-xs" style={{ background: "var(--g-canvas)" }}>
                {i.kind}
              </span>
              {i.content}
              {i.source_url && (
                <a href={i.source_url} className="g-muted ml-1 text-xs underline" target="_blank" rel="noreferrer">
                  source
                </a>
              )}
            </li>
          ))}
        </ol>
        {data.lessons.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 font-semibold">Lessons shared across projects</h3>
            <ul className="space-y-1 text-sm">
              {data.lessons.map((l) => (
                <li key={l.id}>{l.content}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
