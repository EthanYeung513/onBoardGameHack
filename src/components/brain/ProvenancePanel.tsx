"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Click a node → where the brain learned it: aliases, facts (draft and stale marked, rejected never
// shown) and each fact's cited chunks with their source and connector.

const CONNECTOR: Record<string, string> = {
  github: "GitHub",
  slack: "Slack",
  notion: "Notion",
  jira: "Jira",
  linear: "Linear",
  drive: "Drive",
  webapp: "Web app",
  files: "Upload",
  website: "Website",
};

export function ProvenancePanel({ spaceId, entityId, onClose }: { spaceId: Id<"spaces">; entityId: string; onClose: () => void }) {
  const e = useQuery(api.brain.entity, { spaceId, entityId: entityId as Id<"entities"> });
  return (
    <aside className="prov" aria-label="Node provenance">
      <button className="x" onClick={onClose} aria-label="Close">
        ×
      </button>
      {e === undefined ? (
        <div className="pm">Loading…</div>
      ) : (
        <>
          <div className="cap">
            <span className="dot" style={{ background: e.color }} /> {e.cluster} · {e.type.replace("_", " ")}
          </div>
          <div className="pt">{e.name}</div>
          {e.aliases.length > 0 && <div className="pm">also known as {e.aliases.join(", ")}</div>}
          {e.facts.length === 0 && <div className="pm">No facts yet.</div>}
          {e.facts.map((f) => (
            <div key={f.id} className={`pfact ${f.status}`}>
              {f.status === "stale" && (
                <div className="flag stale">
                  stale
                  {f.citations.find((c) => c.changed)?.connector
                    ? ` in ${CONNECTOR[f.citations.find((c) => c.changed)!.connector!]}`
                    : ""}
                </div>
              )}
              {f.status === "draft" && <div className="flag draft">draft</div>}
              <div className="ft">{f.text}</div>
              <div className="fm">
                {f.category} · {Math.round(f.confidence * 100)}% confidence
              </div>
              {f.citations.map((c) => (
                <div key={c.chunkId} className={`cite${c.changed ? " changed" : ""}`}>
                  <div className="src">
                    {c.connector ? <b>{CONNECTOR[c.connector]}</b> : <b>{c.kind ?? "source"}</b>}
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer">
                        {c.title}
                      </a>
                    ) : (
                      <span>{c.title}</span>
                    )}
                    {c.changed && <em>changed</em>}
                  </div>
                  <q>{c.snippet}</q>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
