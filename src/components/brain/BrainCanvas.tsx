"use client";

import { Graph } from "@cosmos.gl/graph";
import { useEffect, useRef } from "react";
import type { BrainGraph } from "@convex/brain";
import { anchorIndex, assignSlots, build, emptySlots, FIRST_ENTITY, HUB, nodeRadius, type Rendered } from "./layout";

// cosmos.gl rendering of brain.html's canvas. cosmos draws the points and links on the GPU; a 2D
// overlay draws the mockup's labels (bold white over hub/anchors, small grey beside larger nodes).

type Props = {
  graph: BrainGraph;
  company: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

export default function BrainCanvas({ graph, company, selectedId, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const cosmos = useRef<Graph | null>(null);
  const slots = useRef(emptySlots());
  const view = useRef<Rendered | null>(null);
  const hovered = useRef<number | undefined>(undefined);
  const latest = useRef({ company, selectedId, onSelect });
  useEffect(() => {
    latest.current = { company, selectedId, onSelect };
  });

  // Create the graph once.
  useEffect(() => {
    const div = host.current!;
    const g = new Graph(div, {
      backgroundColor: "#0d0d10",
      spaceSize: 4096,
      // Same data → same picture on every load (the mockup seeded its rng for a stable layout).
      randomSeed: 42,
      enableSimulation: true,
      // Links are drawn, not sprung: the seeded partition layout (brain.html) stays; repulsion and
      // collisions only spread overlapping nodes.
      simulationGravity: 0,
      simulationCenter: 0,
      simulationRepulsion: 0.02,
      simulationLinkSpring: 0,
      simulationCollision: 1,
      simulationCollisionPadding: 6,
      simulationFriction: 0.8,
      simulationDecay: 600,
      rescalePositions: false,
      fitViewOnInit: true,
      fitViewDelay: 300,
      fitViewPadding: 0.12,
      linkDefaultWidth: 1,
      linkGreyoutOpacity: 0.05,
      renderHoveredPointRing: true,
      hoveredPointRingColor: "#ffffff",
      focusedPointRingColor: "#ffffff",
      outlinedPointRingColor: "#ff6b6b",
      hoveredPointCursor: "pointer",
      enableDrag: true,
      attribution: "",
      onClick: (index) => {
        const n = index === undefined ? undefined : view.current?.nodeAt[index];
        latest.current.onSelect(n ? n.id : null);
      },
      onPointMouseOver: (index) => {
        hovered.current = index;
      },
      onPointMouseOut: () => {
        hovered.current = undefined;
      },
    });
    cosmos.current = g;

    // Label overlay, redrawn every frame from tracked positions.
    let raf = 0;
    const cv = overlay.current!;
    const ctx = cv.getContext("2d")!;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const W = div.clientWidth;
      const H = div.clientHeight;
      if (cv.width !== W * dpr || cv.height !== H * dpr) {
        cv.width = W * dpr;
        cv.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const v = view.current;
      if (!v || !g.isReady) return;
      const pos = g.getTrackedPointPositionsMap();
      const at = (i: number) => {
        const p = pos.get(i);
        return p && Number.isFinite(p[0]) ? g.spaceToScreenPosition(p) : null;
      };
      ctx.textAlign = "center";
      ctx.font = "700 13px Inter, system-ui";
      ctx.fillStyle = "#fff";
      const hub = at(HUB);
      if (hub) ctx.fillText(latest.current.company, hub[0], hub[1] - 26 - 8);
      for (const name of v.anchors) {
        const p = at(anchorIndex(name));
        if (p) ctx.fillText(name, p[0], p[1] - 15 - 8);
      }
      ctx.textAlign = "left";
      ctx.font = "10px Inter, system-ui";
      const sel = latest.current.selectedId;
      v.nodeAt.forEach((n, i) => {
        if (!n) return;
        const r = nodeRadius(n.size);
        const emph = i === hovered.current || n.id === sel;
        if (r <= 5.5 && !emph) return;
        const p = at(i);
        if (!p) return;
        ctx.fillStyle = emph ? "#fff" : "rgba(255,255,255,.55)";
        ctx.fillText(n.stale ? `${n.label} · stale` : n.label, p[0] + r + 3, p[1] + 3);
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      g.destroy();
      cosmos.current = null;
    };
  }, []);

  // Push data whenever the live query changes. New entities append and fade in at their seeded spot.
  useEffect(() => {
    const g = cosmos.current;
    const div = host.current;
    if (!g || !div) return;
    const first = view.current === null;
    assignSlots(slots.current, graph.nodes);
    const v = build(graph, slots.current, div.clientWidth / Math.max(1, div.clientHeight));
    if (!first) {
      // Keep where the simulation moved existing points; only new points take their seeded spot.
      const prev = g.getPointPositionsArray();
      for (let i = 0; i < Math.min(prev.length, v.positions.length); i += 2) {
        const idx = i / 2;
        if (Number.isFinite(prev[i]) && Number.isFinite(v.positions[i]) && idx !== HUB && idx >= FIRST_ENTITY) {
          v.positions[i] = prev[i];
          v.positions[i + 1] = prev[i + 1];
        }
      }
    }
    view.current = v;
    g.setPointPositions(v.positions);
    g.setPointColors(v.colors);
    g.setPointSizes(v.sizes);
    g.setLinks(v.links);
    g.setLinkColors(v.linkColors);
    // Hub and anchors hold the mockup's partition layout.
    g.setPinnedPoints([HUB, ...v.anchors.map(anchorIndex)]);
    g.trackPointPositionsByIndices(Array.from({ length: v.nodeAt.length }, (_, i) => i));
    g.setConfigPartial({ outlinedPointIndices: v.stale });
    g.render();
    // Live updates don't re-run the layout: settled points stay put, new ones fade in at their seeded spot.
    if (first) g.start(0.6);
  }, [graph]);

  // Selection ring.
  useEffect(() => {
    const g = cosmos.current;
    if (!g) return;
    const i = selectedId ? slots.current.index.get(selectedId) : undefined;
    g.setConfigPartial({ focusedPointIndex: i });
  }, [selectedId]);

  return (
    <div className="g-wrap">
      <div ref={host} className="g" aria-label={`${company} knowledge graph`} role="img" />
      <canvas ref={overlay} className="g-labels" aria-hidden />
    </div>
  );
}
