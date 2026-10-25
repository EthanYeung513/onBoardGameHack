"use client";

import { useState } from "react";
import type { BrandProfile } from "@/components/manager/brand";

// The space's extracted identity (brand_profiles), in the legend's chrome: palette swatches,
// typography and voice. No profile yet → says so; offline/partial extraction is labelled.

const QUALITY: Record<string, string> = { partial: "partial (HTML/CSS fallback)", offline: "offline stand-in" };

export function IdentityCard({ brand }: { brand: BrandProfile | null | undefined }) {
  // Mounted client-side only (after the space query resolves); collapsed on phones.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 640);
  if (brand === undefined) return null;
  return (
    <div className="ident">
      <button className="cap" onClick={() => setOpen(!open)} aria-expanded={open}>
        Identity {open ? "−" : "+"}
      </button>
      {open &&
        (brand ? (
          <>
            <div className="sw">
              {brand.palette.slice(0, 6).map((p) => (
                <span key={`${p.role}-${p.hex}`} title={`${p.name} · ${p.role} · ${p.hex}`} style={{ background: p.hex }} />
              ))}
            </div>
            <div className="row">
              <b>Type</b> {brand.typography.heading.family}
              {brand.typography.body.family !== brand.typography.heading.family && ` / ${brand.typography.body.family}`}
            </div>
            {brand.voice && (
              <div className="row">
                <b>Voice</b> {brand.voice.length > 90 ? `${brand.voice.slice(0, 89)}…` : brand.voice}
              </div>
            )}
            {brand.quality && QUALITY[brand.quality] && <div className="q">{QUALITY[brand.quality]}</div>}
          </>
        ) : (
          <div className="row">Not extracted yet.</div>
        ))}
    </div>
  );
}
