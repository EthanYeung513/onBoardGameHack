"use client";

import type { BrainGraph } from "@convex/brain";
import { PARTITIONS } from "@convex/lib/partitions";

// WebGL-unavailable fallback: the same partitions as a list; rows open the provenance panel.
export function BrainList({ graph, onSelect }: { graph: BrainGraph; onSelect: (id: string) => void }) {
  return (
    <div className="blist">
      <p className="pm">This browser can&apos;t draw the graph (WebGL unavailable), so it is shown as a list.</p>
      {PARTITIONS.map((p) => {
        const nodes = graph.nodes.filter((n) => n.cluster === p.name).sort((a, b) => b.size - a.size);
        if (!nodes.length) return null;
        return (
          <section key={p.name}>
            <div className="cap">
              <span className="dot" style={{ background: p.color }} /> {p.name} · {nodes.length}
            </div>
            {nodes.map((n) => (
              <button key={n.id} className="row" onClick={() => onSelect(n.id)}>
                {n.label}
                {n.stale > 0 && <em> · stale</em>}
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
