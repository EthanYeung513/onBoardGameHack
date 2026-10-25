"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useUploadFiles } from "./FilesConnect";
import { Icon } from "./icons";
import { TOOL_CARDS, TOOL_REGISTRY } from "./registry";
import { ToastContext } from "./shared";

// dashboard.html `#tab-tools`, markup for markup: header, the Company brain panel (bar + "N facts
// learned"), and the tool cards. Card state comes from the `connectors` rows; the fact count from
// the brain. Files dropped anywhere on the tab are uploaded (the mockup's "Drop files anywhere").

export function ToolsTab({ spaceId }: { spaceId: Id<"spaces"> }) {
  const [toastText, setToastText] = useState("");
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((t: string) => {
    setToastText(t);
    setShown(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(false), 2600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      <ToolsSection spaceId={spaceId} />
      <div className={`toast${shown ? " show" : ""}`} id="toast">
        {toastText}
      </div>
    </ToastContext.Provider>
  );
}

function ToolsSection({ spaceId }: { spaceId: Id<"spaces"> }) {
  const data = useQuery(api.connectors.list, { spaceId });
  const router = useRouter();
  const upload = useUploadFiles(spaceId);

  const connected = (data?.connectors ?? []).filter((c) => c.connected && TOOL_CARDS.some((t) => t.id === c.type)).length;
  const pct = Math.min(100, (connected / TOOL_CARDS.length) * 100);

  return (
    <section
      id="tab-tools"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="top">
        <div>
          <h1>Connect your tools</h1>
          <p>Agents read connected tools to build the company brain. Nothing is stored outside your space.</p>
        </div>
      </div>
      <div className="panel">
        <div className="ptitle">
          <h3>Company brain</h3>
          <button className="btn btn-dark" onClick={() => router.push(`/brain?space=${spaceId}`)}>
            View brain
          </button>
        </div>
        <div className="pbar">
          <i id="brain-bar" style={{ width: `${Math.max(pct, 15)}%` }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }} id="brain-meta">
          {data ? `${data.facts} facts learned · brain updates as tools connect` : "0 facts learned"}
        </div>
      </div>
      <div className="grid2" id="tool-cards">
        {TOOL_CARDS.map((t) => {
          const Connect = TOOL_REGISTRY[t.id].connect;
          const row = data?.connectors.find((c) => c.type === t.id);
          const desc = row?.status === "error" && row.error ? row.error : t.desc;
          return (
            <div className="tool-card" key={t.id}>
              <div className="ic">
                <Icon name={t.icon} size={20} />
              </div>
              <div>
                <b>{t.name}</b>
                <span style={row?.status === "error" ? { color: "#e11d48" } : undefined}>{desc}</span>
              </div>
              <span className="st">{Connect ? <Connect spaceId={spaceId} /> : null}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
