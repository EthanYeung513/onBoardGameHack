"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/manager/icons";
import { TOOLS, type ToolEntry } from "@/components/manager/tools/registry";
import { timeAgo, type TabProps } from "./shared";

type Connector = FunctionReturnType<typeof api.dashboard.tools>["connectors"][number];

const STATUS: Record<Connector["status"], { label: string; cls: string }> = {
  ready: { label: "Connected ✓", cls: "pill live" },
  syncing: { label: "Syncing…", cls: "pill" },
  authing: { label: "Connecting…", cls: "pill" },
  pending: { label: "Connecting…", cls: "pill" },
  stale: { label: "Out of date", cls: "pill inv" },
  error: { label: "Sync failed", cls: "pill inv" },
};

function detail(c: Connector | undefined): string | null {
  if (!c) return null;
  const parts = [c.label, c.lastSyncedAt ? `Last synced ${timeAgo(c.lastSyncedAt)}` : "Not synced yet"];
  if (c.pendingChanges) parts.push(`${c.pendingChanges} change${c.pendingChanges === 1 ? "" : "s"} queued`);
  if (c.status === "error" && c.error) parts.push(c.error);
  return parts.filter(Boolean).join(" · ");
}

function ToolCard({ tool, connector, spaceId }: { tool: ToolEntry; connector?: Connector; spaceId: TabProps["space"]["_id"] }) {
  const Connect = tool.connect;
  const info = detail(connector);
  return (
    <div className="tool-card">
      <div className="ic">
        <Icon name={tool.icon} size={20} />
      </div>
      <div>
        <b>{tool.name}</b>
        <span>{tool.desc}</span>
        {info && <span title={connector?.error ?? undefined}>{info}</span>}
      </div>
      <span className="st">
        {connector ? (
          <span className={STATUS[connector.status].cls} title={connector.error ?? undefined}>
            {STATUS[connector.status].label}
          </span>
        ) : Connect ? (
          <Connect spaceId={spaceId} />
        ) : (
          <span title={tool.pending ?? "Coming soon"} style={{ display: "inline-flex" }}>
            <button className="btn btn-dark" disabled title={tool.pending ?? "Coming soon"}>
              Connect
            </button>
          </span>
        )}
      </span>
    </div>
  );
}

export function ToolsTab({ space }: TabProps) {
  const data = useQuery(api.dashboard.tools, { spaceId: space._id });
  const router = useRouter();
  const byType = new Map((data?.connectors ?? []).map((c) => [c.type, c]));
  const facts = data?.facts ?? 0;
  const connected = TOOLS.filter((t) => byType.get(t.type)?.status === "ready").length;
  const pct = Math.min(100, (connected / TOOLS.length) * 100);
  const width = facts > 0 ? Math.max(pct, 15) : pct;

  return (
    <>
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
    </>
  );
}
