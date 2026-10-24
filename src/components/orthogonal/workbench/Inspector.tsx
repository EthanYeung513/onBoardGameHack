"use client";

import { useState, type ReactNode } from "react";
import type { Asset, Connector, ConnectorId, Step, StepKind, Swatch, Typography } from "@/lib/orthogonal/types";
import { Chip, SectionLabel, SwitchTrack } from "../ui";
import { KIND_LABEL, KINDS } from "./kinds";

const TABS = [
  ["assets", "Assets"],
  ["design", "Design"],
  ["publish", "Publish"],
] as const;
type Tab = (typeof TABS)[number][0];

interface Props {
  projectId: string;
  siteUrl: string;
  assets: Asset[];
  palette: Swatch[];
  typography: Typography;
  step: Step;
  stepNumber: number;
  connectors: Connector[];
  enabled: Record<ConnectorId, boolean>;
  onBackground: (hex: string) => void;
  onAccent: (hex: string) => void;
  onKind: (kind: StepKind) => void;
  onStep: (patch: Partial<Step>) => void;
  onToggleConnector: (id: ConnectorId) => void;
}

/** Right-hand panel of the workbench: brand assets, per-step design controls and publishing targets. */
export function Inspector(props: Props) {
  const [tab, setTab] = useState<Tab>("assets");
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden border-white/10 lg:border-l">
      <div role="tablist" aria-label="Inspector" className="flex shrink-0 gap-0.5 border-b border-white/10 px-3 py-2.5">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-8 flex-1 cursor-pointer rounded-lg border-0 text-[13px] font-semibold ${tab === key ? "bg-white text-carbon" : "bg-transparent text-white/65"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "assets" && <AssetsPanel {...props} />}
      {tab === "design" && <DesignPanel {...props} />}
      {tab === "publish" && <PublishPanel {...props} />}
    </aside>
  );
}

function AssetsPanel({ assets, siteUrl, stepNumber }: Props) {
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Asset | null>(null);
  const categories = ["All", ...new Set(assets.map((a) => a.category))];
  const q = query.trim().toLowerCase();
  const shown = assets.filter((a) => (category === "All" || a.category === category) && (!q || `${a.name} ${a.meta}`.toLowerCase().includes(q)));

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2.5 px-3 pt-3 pb-2">
        <label className="flex h-9 items-center gap-2 rounded-[9px] bg-white/7 px-3 text-[13px]">
          <span aria-hidden className="text-sm text-white/45">
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${assets.length} assets from ${siteUrl}`}
            aria-label="Search assets"
            className="min-w-0 flex-1 border-0 bg-transparent text-white outline-none placeholder:text-white/45"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Chip key={c} selected={category === c} onClick={() => setCategory(c)} className="h-[26px] px-2.5">
              {c === "All" ? `All ${assets.length}` : c}
            </Chip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2.5">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected(a)}
              aria-pressed={selected?.id === a.id}
              className={`flex animate-[o-pop_.3s_ease_both] cursor-pointer flex-col gap-2 rounded-xl border bg-white/4 p-1.5 text-left text-white hover:bg-white/9 ${selected?.id === a.id ? "border-marigold" : "border-white/7"}`}
            >
              <span
                className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg p-2 text-center leading-[1.1] tracking-[-.02em]"
                style={{
                  background: a.preview.bg,
                  color: a.preview.fg,
                  fontSize: a.preview.size,
                  fontWeight: a.preview.weight,
                  fontFamily: a.preview.mono ? "var(--font-code)" : "inherit",
                }}
              >
                {a.preview.glyph}
              </span>
              <span className="block min-w-0 px-1 pb-1">
                <span className="block truncate text-xs font-semibold">{a.name}</span>
                <span className="block truncate text-[11px] text-white/45">{a.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <p aria-live="polite" className="m-0 min-h-[58px] shrink-0 border-t border-white/10 px-4 py-3 text-xs leading-[1.4] text-white/50">
        {selected
          ? `${selected.name} · ${selected.category} · from ${siteUrl}${selected.source ?? ""}. Drag onto step ${stepNumber} to use it.`
          : "Select an asset to see where it was found. Drag one onto the preview to use it in the current step."}
      </p>
    </>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 text-xs text-white/50">{label}</div>
      {children}
    </div>
  );
}

function SwatchButton({ swatch, selected, round, label, onClick }: { swatch: Swatch; selected: boolean; round?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} ${swatch.name}`}
      aria-pressed={selected}
      className={`size-10 cursor-pointer border-2 p-0 outline-2 outline-offset-2 ${round ? "rounded-full" : "rounded-[10px]"} ${selected ? "border-white outline-marigold" : "border-white/15 outline-transparent"}`}
      style={{ background: swatch.hex }}
    />
  );
}

function DesignPanel({ palette, typography, step, stepNumber, onBackground, onAccent, onKind, onStep }: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-white/10 p-5">
        <SectionLabel>Design · step {stepNumber}</SectionLabel>
        <Field label="Background" className="mb-4">
          <div className="flex gap-2">
            {palette.map((c) => (
              <SwatchButton key={c.hex} swatch={c} label="Background" selected={step.theme.bg === c.hex} onClick={() => onBackground(c.hex)} />
            ))}
          </div>
        </Field>
        <Field label="Accent" className="mb-4">
          <div className="flex gap-2">
            {palette.map((c) => (
              <SwatchButton key={c.hex} swatch={c} label="Accent" round selected={step.theme.accent === c.hex} onClick={() => onAccent(c.hex)} />
            ))}
          </div>
        </Field>
        <Field label="Step type" className="mb-4">
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <Chip key={k} selected={step.kind === k} onClick={() => onKind(k)} className="h-[30px] px-[11px]">
                {KIND_LABEL[k]}
              </Chip>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Reward">
            <div className="flex h-[38px] items-center overflow-hidden rounded-[10px] border border-white/14">
              <button
                type="button"
                aria-label="Less XP"
                onClick={() => onStep({ xp: Math.max(0, step.xp - 10) })}
                className="h-full w-[34px] cursor-pointer border-0 bg-transparent text-base text-white"
              >
                −
              </button>
              <span className="flex-1 text-center text-[13px] font-semibold tabular-nums">{step.xp} XP</span>
              <button type="button" aria-label="More XP" onClick={() => onStep({ xp: step.xp + 10 })} className="h-full w-[34px] cursor-pointer border-0 bg-transparent text-base text-white">
                +
              </button>
            </div>
          </Field>
          <Field label="Badge">
            <input
              value={step.badge}
              onChange={(e) => onStep({ badge: e.target.value })}
              aria-label="Badge"
              className="h-[38px] w-full rounded-[10px] border border-white/14 bg-transparent px-3 text-[13px] font-semibold text-white scheme-dark outline-none focus:border-white/40"
            />
          </Field>
        </div>
      </div>
      <div className="p-5">
        <SectionLabel>Type</SectionLabel>
        <div className="mb-1.5 flex justify-between text-[13px]">
          <span className="font-semibold">{typography.heading.family}</span>
          <span className="text-white/50">Headings · {typography.heading.weight}</span>
        </div>
        <div className="flex justify-between text-[13px]">
          <span>{typography.body.family}</span>
          <span className="text-white/50">
            Body · {typography.body.weight}
            {typography.body.metrics && ` · ${typography.body.metrics}`}
          </span>
        </div>
      </div>
    </div>
  );
}

function PublishPanel({ projectId, connectors, enabled, onToggleConnector }: Props) {
  const host = enabled.cloudflare ? "https://edge.orthogonal.dev" : "https://cdn.orthogonal.dev";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="border-b border-white/10 p-5">
        <SectionLabel>Connectors</SectionLabel>
        <div className="flex flex-col gap-2">
          {connectors.map((c) => {
            const on = enabled[c.id];
            return (
              <div key={c.id} className={`flex items-center gap-3 rounded-xl border bg-white/5 px-3 py-2.5 ${on ? "border-marigold/50" : "border-transparent"}`}>
                <span
                  aria-hidden
                  className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold"
                  style={{ background: c.bg, color: c.fg }}
                >
                  {c.mono}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-xs leading-[1.35] text-white/50">{c.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={c.name}
                  onClick={() => onToggleConnector(c.id)}
                  className="cursor-pointer border-0 bg-transparent p-0"
                >
                  <SwitchTrack on={on} bg={on ? "var(--color-marigold)" : "rgba(255,255,255,.18)"} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="p-5">
        <SectionLabel>Embed</SectionLabel>
        <pre className="m-0 rounded-xl border border-white/10 bg-graphite p-3 font-code text-[11.5px] leading-[1.55] break-all whitespace-pre-wrap text-white">
          {`<script src="${host}/o.js"\n  data-project="${projectId}"></script>`}
        </pre>
      </div>
    </div>
  );
}
