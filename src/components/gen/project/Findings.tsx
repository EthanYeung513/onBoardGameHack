"use client";
import { useState } from "react";
import type { ProjectState } from "@/lib/pipeline/state";
import type { ProjectModel } from "@/lib/schemas/project-model";
import type { DesignTokens } from "@/lib/schemas/tokens";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function ListField({ label, value, onChange, testId, disabled }: { label: string; value: string[]; onChange: (v: string[]) => void; testId?: string; disabled?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-semibold">{label}</span>
      <textarea className="g-input min-h-24" disabled={disabled} value={value.join("\n")} onChange={(e) => onChange(lines(e.target.value))} data-testid={testId} />
      <span className="g-muted text-xs">One per line</span>
    </label>
  );
}

export function Findings({ state, editable, onConfirmed }: { state: ProjectState; editable: boolean; onConfirmed: () => void }) {
  const [model, setModel] = useState<ProjectModel>(state.model!.model_json as ProjectModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokens = state.tokens?.tokens_json as DesignTokens | undefined;
  const set = <K extends keyof ProjectModel>(k: K, v: ProjectModel[K]) => setModel({ ...model, [k]: v });
  const confirmed = Boolean(state.model?.confirmed_at);

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/gen/projects/${state.project.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Could not save");
    onConfirmed();
  }

  return (
    <section className="space-y-6" aria-labelledby="found-h" data-testid="findings">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 id="found-h" className="text-2xl font-bold">
            What we found
          </h2>
          <p className="g-muted text-sm">{editable ? "Edit anything that is wrong, then confirm. Nothing is generated until you do." : confirmed ? "Confirmed. Generation uses this version." : ""}</p>
        </div>
        {editable && (
          <button className="g-btn ml-auto" onClick={confirm} disabled={busy} data-testid="confirm-findings">
            {busy ? "Saving" : "Confirm findings"}
          </button>
        )}
      </div>
      {error && <p role="alert" style={{ color: "var(--g-danger)" }}>{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="g-panel space-y-5 p-5">
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Company</span>
            <input className="g-input" value={model.companyName} disabled={!editable} onChange={(e) => set("companyName", e.target.value)} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Product summary</span>
            <textarea className="g-input min-h-28" value={model.productSummary} disabled={!editable} onChange={(e) => set("productSummary", e.target.value)} data-testid="field-summary" />
          </label>
          <ListField label="Target audience" value={model.targetAudience} onChange={(v) => set("targetAudience", v)} disabled={!editable} />
          <ListField label="Value propositions" value={model.valuePropositions} onChange={(v) => set("valuePropositions", v)} disabled={!editable} />
          <ListField label="Key user actions" value={model.keyUserActions} onChange={(v) => set("keyUserActions", v)} disabled={!editable} />
          <div className="space-y-2">
            <span className="text-sm font-semibold">Features and their evidence</span>
            <ul className="space-y-3">
              {model.features.map((f, i) => (
                <li key={i} className="rounded-lg border p-3" style={{ borderColor: "var(--g-line)" }}>
                  <input
                    className="g-input mb-2 font-semibold"
                    value={f.name}
                    disabled={!editable}
                    onChange={(e) => set("features", model.features.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <textarea
                    className="g-input min-h-16 text-sm"
                    value={f.description}
                    disabled={!editable}
                    onChange={(e) => set("features", model.features.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  />
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {f.sourceUrls.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="rounded px-2 py-0.5 underline-offset-2 hover:underline" style={{ background: "var(--g-canvas)" }}>
                        {new URL(u).pathname || "/"}
                      </a>
                    ))}
                    {editable && (
                      <button className="ml-auto" style={{ color: "var(--g-danger)" }} onClick={() => set("features", model.features.filter((_, j) => j !== i))}>
                        Remove feature
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Tone of voice</span>
            <input className="g-input" value={model.toneOfVoice.adjectives.join(", ")} disabled={!editable} onChange={(e) => set("toneOfVoice", { ...model.toneOfVoice, adjectives: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            <textarea className="g-input min-h-16 text-sm" value={model.toneOfVoice.description} disabled={!editable} onChange={(e) => set("toneOfVoice", { ...model.toneOfVoice, description: e.target.value })} />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-semibold">What getting started means</span>
            <textarea className="g-input min-h-16" value={model.gettingStarted.summary} disabled={!editable} onChange={(e) => set("gettingStarted", { ...model.gettingStarted, summary: e.target.value })} />
          </label>
          <ListField label="First steps" value={model.gettingStarted.firstSteps} onChange={(v) => set("gettingStarted", { ...model.gettingStarted, firstSteps: v })} disabled={!editable} />
          <label className="block space-y-1">
            <span className="text-sm font-semibold">Moment of success</span>
            <input className="g-input" value={model.gettingStarted.successMoment} disabled={!editable} onChange={(e) => set("gettingStarted", { ...model.gettingStarted, successMoment: e.target.value })} />
          </label>
        </div>

        <div className="space-y-6">
          {tokens && (
            <div className="g-panel space-y-4 p-5" data-testid="brand-panel">
              <div className="flex items-center gap-3">
                <h3 className="font-bold">Brand</h3>
                <span className="g-muted text-xs">from {state.tokens?.source}</span>
              </div>
              {tokens.logo.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={tokens.logo.url} alt={tokens.logo.alt || "Logo"} className="max-h-10 max-w-48 object-contain" />
              )}
              <ul className="grid grid-cols-4 gap-2">
                {Object.entries(tokens.colors).map(([k, v]) => (
                  <li key={k} className="text-xs">
                    <span className="block h-10 rounded-md border" style={{ background: v, borderColor: "var(--g-line)" }} />
                    <span className="mt-1 block font-medium">{k}</span>
                    <span className="g-muted block tabular-nums">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <p style={{ fontFamily: tokens.typography.headingFont, fontWeight: tokens.typography.headingWeight }} className="text-2xl">
                  {model.companyName}
                </p>
                <p style={{ fontFamily: tokens.typography.bodyFont }}>{model.valuePropositions[0]}</p>
                <p className="g-muted text-xs">
                  {tokens.typography.headingFont.split(",")[0]} headings, {tokens.typography.bodyFont.split(",")[0]} body, radius {tokens.radii.md}px
                </p>
              </div>
            </div>
          )}
          {state.screenshots.length > 0 && (
            <div className="g-panel space-y-3 p-5">
              <h3 className="font-bold">Screenshots</h3>
              <ul className="grid grid-cols-2 gap-2">
                {state.screenshots.map((s) => (
                  <li key={s.id}>
                    <a href={s.signedUrl ?? "#"} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.signedUrl ?? ""} alt={`Screenshot of ${s.source_url}`} className="aspect-[16/10] w-full rounded border object-cover object-top" style={{ borderColor: "var(--g-line)" }} />
                    </a>
                    <span className="g-muted block truncate text-xs">{new URL(s.source_url).pathname}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="g-panel p-5">
            <h3 className="mb-2 font-bold">Crawled pages</h3>
            <table className="w-full text-left text-xs" data-testid="pages-table">
              <thead className="g-muted">
                <tr>
                  <th className="py-1">Page</th>
                  <th className="py-1">Type</th>
                  <th className="py-1">Fetched via</th>
                  <th className="py-1 text-right">Words</th>
                </tr>
              </thead>
              <tbody>
                {state.pages.map((p) => (
                  <tr key={p.id} className="border-t" style={{ borderColor: "var(--g-line)" }}>
                    <td className="max-w-40 truncate py-1">
                      <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline" title={p.url}>
                        {new URL(p.url).pathname || "/"}
                      </a>
                    </td>
                    <td className="py-1">{p.page_type}</td>
                    <td className="py-1" style={{ color: p.fetch_method === "browser" ? "var(--g-marigold-deep)" : undefined }}>
                      {p.status === "fetched" ? p.fetch_method : p.status}
                    </td>
                    <td className="py-1 text-right tabular-nums">{p.word_count ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
