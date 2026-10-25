"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Icon } from "@/components/manager/icons";

// The mockup's #ai-fab + #ai-pop (F30). Insights come from `dashboard.insights` — fixed rules over
// the space's real aggregates. Free-form questions have no backend yet, so the reply says so.

const NO_QA = "I can't answer free-form questions yet.";

export function AiAssistant({ spaceId }: { spaceId: Id<"spaces"> }) {
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<{ who: string; text: string }[]>([]);
  const [q, setQ] = useState("");
  const insights = useQuery(api.dashboard.insights, open ? { spaceId } : "skip");

  const ask = () => {
    const text = q.trim();
    if (!text) return;
    setChat((c) => [...c, { who: "You", text }, { who: "Agent", text: NO_QA }]);
    setQ("");
  };

  return (
    <>
      <button id="ai-fab" onClick={() => setOpen((o) => !o)} title="AI Assistant">
        <Icon name="sparkle" />
      </button>
      <div id="ai-pop" hidden={!open}>
        <div className="ai-tag">
          <Icon name="sparkle" /> AI Assistant<span id="ai-ctx" style={{ fontWeight: 400, color: "var(--muted)" }}> · insights</span>
        </div>
        <ul id="ai-insights">
          {insights?.length === 0 && <li>No insights yet.</li>}
          {insights?.map((parts, i) => (
            <li key={i}>{parts.map((s, j) => (s.bold ? <b key={j}>{s.text}</b> : <span key={j}>{s.text}</span>))}</li>
          ))}
          {chat.map((m, i) => (
            <li key={`c${i}`}>
              <b>{m.who}:</b> {m.text}
            </li>
          ))}
        </ul>
        <div id="ai-actions" />
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input
            style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
            placeholder="Ask a question…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask()}
          />
          <button className="btn btn-primary" onClick={ask}>
            →
          </button>
        </div>
      </div>
    </>
  );
}
