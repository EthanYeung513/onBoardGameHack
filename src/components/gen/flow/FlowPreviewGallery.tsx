"use client";

import { useState } from "react";
import { SAMPLE_COMPANY, SAMPLE_SPECS } from "@/lib/flow/sample";
import { DEFAULT_TOKENS, type DesignTokens } from "@/lib/schemas/tokens";
import { FlowRenderer, type FlowEvent } from "./FlowRenderer";

const NIGHT_TOKENS: DesignTokens = {
  ...DEFAULT_TOKENS,
  colors: {
    primary: "#7cc4a4",
    secondary: "#a5b4fc",
    accent: "#ffb454",
    background: "#12151a",
    surface: "#1b1f26",
    text: "#e8eaed",
    mutedText: "#9aa3ad",
    border: "#2d333c",
  },
  typography: { ...DEFAULT_TOKENS.typography, headingFont: "'Trebuchet MS', system-ui, sans-serif" },
  radii: { sm: 6, md: 12, lg: 22, pill: 999 },
  mode: "dark",
};

const THEMES: Record<string, { label: string; tokens: DesignTokens }> = {
  default: { label: "Default tokens", tokens: DEFAULT_TOKENS },
  night: { label: "Night tokens", tokens: NIGHT_TOKENS },
};

const STYLE_NAMES: Record<string, string> = {
  quest_path: "Quest path",
  checklist_streak: "Checklist with streaks",
  quiz_tour: "Quiz-led tour",
};

export function FlowPreviewGallery({
  initialVariant,
  initialStep,
  initialTheme,
  reducedMotion,
}: {
  initialVariant: string;
  initialStep?: number;
  initialTheme: string;
  reducedMotion?: boolean;
}) {
  const [variant, setVariant] = useState(initialVariant);
  const [theme, setTheme] = useState(initialTheme in THEMES ? initialTheme : "default");
  const [log, setLog] = useState<string[]>([]);
  const tokens = THEMES[theme].tokens;
  const shown = variant === "all" ? SAMPLE_SPECS : SAMPLE_SPECS.filter((s) => s.variantKey === variant);
  const onEvent = (key: string) => (e: FlowEvent) => {
    if (e.type === "step_view" || e.type === "answer") return;
    setLog((l) => [`${key}: ${e.type}${"stepId" in e ? ` ${e.stepId}` : ""}${"badgeId" in e ? ` ${e.badgeId}` : ""}`, ...l].slice(0, 6));
  };
  const dark = tokens.mode === "dark";

  return (
    <main
      className="min-h-screen px-4 py-8 sm:px-8"
      style={{ background: tokens.colors.background, color: tokens.colors.text, fontFamily: tokens.typography.bodyFont }}
    >
      <div className="mx-auto grid max-w-[1320px] gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="m-0 text-2xl" style={{ fontFamily: tokens.typography.headingFont, fontWeight: tokens.typography.headingWeight }}>
              Onboarding flows for {SAMPLE_COMPANY.name}
            </h1>
            <p className="m-0 mt-1 text-sm" style={{ color: tokens.colors.mutedText }}>
              Three sample specs rendered with the same component. Pick a variant to play it at full width.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Segmented
              label="Variant"
              value={variant}
              onChange={setVariant}
              options={[{ value: "all", label: "All three" }, ...SAMPLE_SPECS.map((s) => ({ value: s.variantKey, label: STYLE_NAMES[s.gamification.style] }))]}
              tokens={tokens}
            />
            <Segmented
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={Object.entries(THEMES).map(([value, t]) => ({ value, label: t.label }))}
              tokens={tokens}
            />
          </div>
        </header>

        <div className={variant === "all" ? "grid items-start gap-6 lg:grid-cols-3" : "mx-auto grid w-full max-w-[540px] gap-6"}>
          {shown.map((spec) => (
            <div key={`${spec.variantKey}-${theme}`} data-testid={`preview-${spec.variantKey}`} className="grid gap-2">
              <p className="m-0 text-sm" style={{ color: tokens.colors.mutedText }}>
                {STYLE_NAMES[spec.gamification.style]}, {spec.steps.length} steps, {spec.gamification.mechanics.progress === "path_map" ? "path map" : "progress bar"}
              </p>
              <FlowRenderer
                spec={spec}
                tokens={tokens}
                initialIndex={initialStep}
                reducedMotion={reducedMotion}
                onEvent={onEvent(spec.variantKey)}
                onLead={(email) => setLog((l) => [`${spec.variantKey}: lead ${email}`, ...l].slice(0, 6))}
                className="min-h-[560px]"
              />
            </div>
          ))}
        </div>

        <section aria-label="Event log" className="text-xs" style={{ color: tokens.colors.mutedText }}>
          <p className="m-0">Recent events</p>
          <ol data-testid="preview-log" className="m-0 mt-1 grid gap-0.5 pl-4 font-mono" style={{ opacity: dark ? 0.85 : 1 }}>
            {log.length === 0 ? <li>Nothing yet. Play a flow to see events here.</li> : log.map((l, i) => <li key={i}>{l}</li>)}
          </ol>
        </section>
      </div>
    </main>
  );
}

function Segmented({
  label,
  value,
  onChange,
  options,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  tokens: DesignTokens;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex gap-1 p-1" style={{ borderRadius: 10, background: tokens.colors.surface, border: `1px solid ${tokens.colors.border}` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-testid={`switch-${o.value}`}
            onClick={() => onChange(o.value)}
            className="px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-1"
            style={{
              borderRadius: 7,
              background: on ? tokens.colors.text : "transparent",
              color: on ? tokens.colors.surface : tokens.colors.text,
              outlineColor: tokens.colors.primary,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
