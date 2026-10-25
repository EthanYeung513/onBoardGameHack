"use client";

import { HEADLINE_PRESETS, orderedChoices, SOURCE_LABEL, type Choice, type DesignValues } from "@/lib/editor/design";
import type { BrandField, BrandFieldOptions, BrandOptions } from "./contracts";

// editor.html `renderDesign`: Primary color, Accent color, Corner radius, Headline style. Each control
// leads with the learned recommendation (brand.options: Mubit / learned / heuristic) and the other
// extracted candidates; the mockup's own input stays for custom values. `options === null` means
// brand learning isn't available — the controls are still bound to the space's brand tokens.

type Props = {
  options: BrandOptions | null | undefined;
  design: DesignValues;
  /** Live preview only (dragging a colour or slider). */
  onPreview: (field: BrandField, value: string) => void;
  /** A committed pick — recorded through brand.decide. */
  onPick: (field: BrandField, value: string) => void;
  /** The logo the scan found on the company's site (stored copy), if any. */
  logo?: { url: string; label: string } | null;
};

const HEX = /^#[0-9a-f]{6}$/i;
const toHex = (v: string) => {
  const s = v.trim();
  if (HEX.test(s)) return s.toLowerCase();
  const m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : null;
};

function Recs({ field, opts, current, onPick }: { field: BrandField; opts: BrandFieldOptions | undefined; current: string; onPick: Props["onPick"] }) {
  const choices = orderedChoices(opts);
  if (!opts || choices.length === 0) return null;
  const color = field === "primary" || field === "accent";
  const same = (c: Choice) =>
    field === "radius" ? parseFloat(c.value) === parseFloat(current) : c.value.trim().toLowerCase() === current.trim().toLowerCase();
  const title = (c: Choice) =>
    c.recommended ? `Recommended by ${SOURCE_LABEL[opts.source]}` : c.evidence ? `Found: ${c.evidence}` : c.value;
  return (
    <div className="recs" data-testid={`recs-${field}`}>
      {choices.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`rec${c.recommended ? " best" : ""}${same(c) ? " on" : ""}`}
          title={title(c)}
          aria-label={`${c.value}${c.recommended ? " (recommended)" : ""}`}
          onClick={() => onPick(field, field === "radius" ? String(parseFloat(c.value) || 0) : c.value)}
        >
          {color ? <i style={{ background: toHex(c.value) ?? c.value }} /> : null}
          <span className="rv">{c.value}</span>
          {c.recommended && <span className="badge">Recommended</span>}
          {c.recommended && <span className="src">via {SOURCE_LABEL[opts.source]}</span>}
        </button>
      ))}
    </div>
  );
}

export function DesignPanel({ options, design, onPreview, onPick, logo }: Props) {
  const f = options?.fields ?? {};
  // With brand learning the headline is the heading font (its candidates); without it, the mockup's presets.
  const headlineChoices = orderedChoices(f.headline).map((c) => c.value);
  const headlineList = [...new Set([...(headlineChoices.length ? headlineChoices : HEADLINE_PRESETS), design.headline])];

  const colorCtl = (field: "primary" | "accent", label: string) => (
    <div className="dctl">
      <label>{label}</label>
      <Recs field={field} opts={f[field]} current={design[field]} onPick={onPick} />
      <div className="swrow">
        <input
          type="color"
          aria-label={`${label} custom`}
          value={toHex(design[field]) ?? "#000000"}
          onChange={(e) => onPreview(field, e.target.value)}
        />
        <span className="val">{design[field]}</span>
      </div>
    </div>
  );

  return (
    <>
      <div className="dctl">
        <label>Logo</label>
        {logo ? (
          <div className="logo-prev">
            {/* Light and dark chips: logos made for dark headers (white wordmarks) stay legible. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.url} alt="Your company logo on a light background, found on your site" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo.url} alt="" aria-hidden className="on-dark" />
            <span className="val">{logo.label} · found on your site</span>
          </div>
        ) : (
          <span className="val">No logo found on your site yet.</span>
        )}
      </div>
      {colorCtl("primary", "Primary color")}
      {colorCtl("accent", "Accent color")}
      <div className="dctl">
        <label>Corner radius</label>
        <Recs field="radius" opts={f.radius} current={`${design.radius}px`} onPick={onPick} />
        <div className="swrow">
          <input
            type="range"
            aria-label="Corner radius custom"
            min={0}
            max={20}
            value={design.radius}
            onChange={(e) => onPreview("radius", e.target.value)}
          />
          <span className="val">{design.radius}px</span>
        </div>
      </div>
      <div className="dctl">
        <label>Headline style</label>
        <Recs field="headline" opts={f.headline} current={design.headline} onPick={onPick} />
        <select aria-label="Headline style" value={design.headline} onChange={(e) => onPick("headline", e.target.value)}>
          {headlineList.map((h) => (
            <option key={h} value={h}>
              {h}
              {f.headline && h === f.headline.recommended ? " (Recommended)" : ""}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
