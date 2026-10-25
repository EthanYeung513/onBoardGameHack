"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/manager/icons";
import { TOOLS, type ToolEntry } from "@/components/manager/tools/registry";
import { ToastContext } from "@/components/manager/tools/shared";
import { timeAgo, type TabProps } from "./shared";

type Connector = FunctionReturnType<typeof api.dashboard.tools>["connectors"][number];

/** Status pill per connector state; `null` = nothing to show (never connected, or auth cancelled). */
const STATUS: Record<Connector["status"], { label: string; cls: string } | null> = {
  ready: { label: "Connected ✓", cls: "pill live" },
  syncing: { label: "Syncing…", cls: "pill inv" },
  authing: { label: "Connecting…", cls: "pill" },
  pending: null,
  stale: { label: "Out of date", cls: "pill inv" },
  error: { label: "Error", cls: "pill err" },
};

function detail(c: Connector | undefined): string | null {
  if (!c || c.status === "pending") return null;
  const parts = [c.label, c.lastSyncedAt ? `Last synced ${timeAgo(c.lastSyncedAt)}` : "Not synced yet"];
  if (c.pendingChanges) parts.push(`${c.pendingChanges} change${c.pendingChanges === 1 ? "" : "s"} queued`);
  if (c.status === "error" && c.error) parts.push(c.error);
  return parts.filter(Boolean).join(" · ");
}

/** The whole card is the button: it opens the tool's page to connect, update, or upload more. */
export function ToolCard({ tool, connector, spaceId }: { tool: ToolEntry; connector?: Connector; spaceId: TabProps["space"]["_id"] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const Panel = tool.panel;
  const info = tool.status ? detail(connector) : null;
  const pill = tool.status && connector ? STATUS[connector.status] : null;
  return (
    <>
      <div
        className="tool-card"
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-label={tool.name}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="ic">
          <Icon name={tool.icon} size={20} />
        </div>
        <div>
          <b>{tool.name}</b>
          <span>{tool.desc}</span>
          {info && <span title={connector?.error ?? undefined}>{info}</span>}
        </div>
        <span className="st">
          {pill ? (
            <span className={pill.cls} title={connector?.error ?? undefined}>
              {pill.label}
            </span>
          ) : (
            <span className="go" aria-hidden="true">
              ›
            </span>
          )}
        </span>
      </div>
      <Panel spaceId={spaceId} open={open} onClose={close} />
    </>
  );
}

export function ToolsTab({ space, toast }: TabProps) {
  const data = useQuery(api.dashboard.tools, { spaceId: space._id });
  const router = useRouter();
  const byType = new Map((data?.connectors ?? []).map((c) => [c.type, c]));
  const facts = data?.facts ?? 0;
  const connected = TOOLS.filter((t) => byType.get(t.type)?.status === "ready").length;
  const pct = Math.min(100, (connected / TOOLS.length) * 100);
  const width = facts > 0 ? Math.max(pct, 15) : pct;

  return (
    <ToastContext.Provider value={toast}>
      <div className="top">
        <div>
          <h1>Connect your tools</h1>
          <p>Agents read connected tools to build the company brain. Nothing is stored outside your space.</p>
        </div>
      </div>
      <div className="panel">
        <div className="ptitle">
          <h3>Company brain</h3>
          <button className="btn btn-dark" onClick={() => router.push(`/brain?space=${space._id}`)}>
            View brain
          </button>
        </div>
        <div className="pbar">
          <i id="brain-bar" style={{ width: `${width}%` }} />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }} id="brain-meta">
          {facts} facts learned · brain updates as tools connect
        </div>
      </div>
      <div className="grid2" id="tool-cards">
        {TOOLS.map((t) => (
          <ToolCard key={t.type} tool={t} connector={byType.get(t.type)} spaceId={space._id} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
