"use client";

import { useState } from "react";
import type { EditorAsset } from "@convex/editor";

// editor.html `renderAssets`: search, category chips, two-column cards — from the scan's real
// logos/tokens and the space's asset/screenshot source items.

const CATS = ["All", "Brand", "Colors", "Type", "Icons", "Copy"] as const;

type Props = {
  host: string;
  assets: EditorAsset[] | undefined;
  selected: string | null;
  onSelect: (asset: EditorAsset) => void;
};

function Thumb({ a }: { a: EditorAsset }) {
  if (a.thumb.image) {
    return (
      <div className="thumb img">
        {/* eslint-disable-next-line @next/next/no-img-element -- scraped third-party URLs */}
        <img src={a.thumb.image} alt={a.name} loading="lazy" />
      </div>
    );
  }
  if (a.thumb.color) {
    return (
      <div className="thumb" style={{ background: a.thumb.color, color: "#fff" }}>
        {a.thumb.text}
      </div>
    );
  }
  return (
    <div className="thumb" style={{ background: "#1d1d1f", color: a.category === "copy" ? "#9a9aa0" : "#e8e8ea" }}>
      {a.thumb.text}
    </div>
  );
}

export function AssetsPanel({ host, assets, selected, onSelect }: Props) {
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [q, setQ] = useState("");
  const all = assets ?? [];
  const shown = all.filter(
    (a) => (cat === "All" || a.category === cat.toLowerCase()) && (!q || `${a.name} ${a.meta}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <input className="search" placeholder={`Search ${all.length} assets from ${host}`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        {CATS.map((c) => (
          <button key={c} className={`chip${c === cat ? " on" : ""}`} onClick={() => setCat(c)}>
            {c}
            {c === "All" ? ` ${all.length}` : ""}
          </button>
        ))}
      </div>
      {assets && all.length === 0 ? (
        <p className="side-empty">No assets from {host} yet — they appear here once the scan has read your site.</p>
      ) : (
        <div className="agrid">
          {shown.map((a) => (
            <button key={a.id} className={`acard${selected === a.id ? " sel" : ""}`} onClick={() => onSelect(a)}>
              <Thumb a={a} />
              <div className="meta">
                <b>{a.name}</b>
                <span>{a.meta}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
