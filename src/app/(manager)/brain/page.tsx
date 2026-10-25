"use client";

import { useConvexAuth, useQuery } from "convex/react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Component, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PARTITIONS } from "@convex/lib/partitions";
import { BrainList } from "@/components/brain/BrainList";
import { IdentityCard } from "@/components/brain/IdentityCard";
import { webglAvailable } from "@/components/brain/layout";
import { ProvenancePanel } from "@/components/brain/ProvenancePanel";
import { brandVars } from "@/components/manager/brand";
import "./brain.css";

// brain.html: the company brain as a knowledge graph. The mockup's seeded-random canvas is replaced
// by cosmos.gl over the live `brain.graph` query; everything else (header, legend, caption) is the
// mockup's markup and styles.

const BrainCanvas = dynamic(() => import("@/components/brain/BrainCanvas"), { ssr: false });

const noSubscribe = () => () => {};

function ago(ts: number, now: number) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function Brain() {
  const { isAuthenticated } = useConvexAuth();
  const params = useSearchParams();
  const spaces = useQuery(api.spaces.mine, isAuthenticated ? {} : "skip");
  const wanted = params.get("space");
  const spaceId = (wanted ?? spaces?.find((s) => s.role !== "hire")?._id) as Id<"spaces"> | undefined;
  const ready = isAuthenticated && !!spaceId;
  const space = useQuery(api.spaces.get, ready ? { spaceId: spaceId! } : "skip");
  const graph = useQuery(api.brain.graph, ready ? { spaceId: spaceId! } : "skip");
  const stats = useQuery(api.brain.stats, ready ? { spaceId: spaceId! } : "skip");
  const [selected, setSelected] = useState<string | null>(null);
  // WebGL is a browser fact: null while server-rendering, then fixed.
  const gl = useSyncExternalStore(noSubscribe, webglAvailable, () => null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const company = space?.name ?? "Company";
  const back = `/dashboard?tab=tools${spaceId ? `&space=${spaceId}` : ""}`;
  const empty = graph !== undefined && graph.nodes.length === 0;
  const legend = stats ? stats.clusters.filter((c) => PARTITIONS.find((p) => p.name === c.name)!.mockup || c.entities > 0) : [];

  return (
    <div className="brain-page" style={brandVars(space?.brand)}>
      <div className="hdr">
        <a className="back" href={back}>
          <svg className="icn" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>{" "}
          Back
        </a>
        <div>
          <div className="t">{company} brain</div>
          <div className="m">knowledge graph</div>
        </div>
      </div>

      {graph && gl === true && <BrainCanvas graph={graph} company={company} selectedId={selected} onSelect={setSelected} />}
      {graph && gl === false && <BrainList graph={graph} onSelect={setSelected} />}
      {empty && (
        <div className="empty">
          Nothing in the brain yet.
        </div>
      )}
      {spaces && spaces.length === 0 && <div className="empty">Create a space first.</div>}

      {!selected && space && <IdentityCard brand={space.brand} />}

      {stats && (
        <div className="legend">
          <div className="cap">Partitions</div>
          {legend.map((c) => (
            <div key={c.name} className="row">
              <span className="dot" style={{ background: c.color }} />
              {c.name} · {c.entities}
            </div>
          ))}
        </div>
      )}

      {stats && graph && (
        <div className="meta">
          {graph.nodes.length} nodes · {graph.edges.length} edges
          <br />
          built from {stats.connectedTools} connected tools{stats.websiteScanned ? " + website scrape" : ""}
          <br />
          <span style={{ opacity: 0.6 }}>
            live graph · {stats.lastUpdated ? `updated ${ago(stats.lastUpdated, now)}` : "no facts yet"}
            {stats.facts > 0 && ` · ${stats.facts} facts`}
            {" · "}
            <a href={`/api/brain/graph.gexf?space=${spaceId}`} download>
              Export GEXF
            </a>
          </span>
        </div>
      )}

      {selected && spaceId && graph?.nodes.some((n) => n.id === selected) && <ProvenancePanel spaceId={spaceId} entityId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** A missing space or one the caller doesn't manage → the error in the page's own chrome. */
class Guard extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    const data = err instanceof ConvexError ? (err.data as { message?: string }) : null;
    return { message: data?.message ?? "Couldn't load the brain." };
  }
  render() {
    if (!this.state.message) return this.props.children;
    return (
      <div className="brain-page">
        <div className="hdr">
          <a className="back" href="/dashboard?tab=tools">
            Back
          </a>
        </div>
        <div className="empty">{this.state.message}</div>
      </div>
    );
  }
}

export default function BrainPage() {
  return (
    <Guard>
      <Suspense>
        <Brain />
      </Suspense>
    </Guard>
  );
}
