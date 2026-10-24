"use client";
import { useState } from "react";
import { FlowRenderer } from "@/components/gen/flow/FlowRenderer";
import type { FlowSpec } from "@/lib/flow/spec";
import type { ProjectState } from "@/lib/pipeline/state";
import type { DesignTokens } from "@/lib/schemas/tokens";

export type FlowTab = "preview" | "files" | "chat" | "memory";

export function Flows({
  state,
  renderTab,
}: {
  state: ProjectState;
  renderTab?: (tab: Exclude<FlowTab, "preview">, flow: ProjectState["flows"][number]) => React.ReactNode;
}) {
  const flows = [...state.flows].sort((a, b) => a.variant_key.localeCompare(b.variant_key));
  const [active, setActive] = useState(flows[0]?.variant_key);
  const [tab, setTab] = useState<FlowTab>("preview");
  const [runKey, setRunKey] = useState(0);
  const flow = flows.find((f) => f.variant_key === active) ?? flows[0];
  const tokens = state.tokens?.tokens_json as DesignTokens | undefined;
  if (!flow || !tokens) return null;
  const spec = flow.spec_json as FlowSpec;

  return (
    <section className="space-y-4" aria-labelledby="flows-h" data-testid="flows">
      <div className="flex flex-wrap items-end gap-3">
        <h2 id="flows-h" className="text-2xl font-bold">
          Onboarding flows
        </h2>
        <div role="tablist" aria-label="Variants" className="ml-auto flex gap-1 rounded-lg p-1" style={{ background: "var(--g-surface)", border: "1px solid var(--g-line)" }}>
          {flows.map((f) => (
            <button
              key={f.variant_key}
              role="tab"
              aria-selected={f.variant_key === flow.variant_key}
              className="rounded-md px-3 py-1.5 text-sm font-semibold"
              style={f.variant_key === flow.variant_key ? { background: "var(--g-ink)", color: "#fff" } : undefined}
              onClick={() => setActive(f.variant_key)}
              data-testid={`variant-${f.variant_key}`}
            >
              {(f.spec_json as FlowSpec).title}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="g-muted">
          Version {flow.version}, {flow.status}, {spec.steps.length} steps
        </span>
        <span className="ml-auto flex gap-1" role="tablist" aria-label="Flow views">
          {(["preview", "files", "chat", "memory"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className="g-btn g-btn-quiet py-1 text-sm capitalize" style={tab === t ? { background: "var(--g-surface)", borderColor: "var(--g-ink)" } : undefined} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
              {t}
            </button>
          ))}
        </span>
      </div>
      {tab === "preview" ? (
        <div className="space-y-2">
          <div className="flex gap-3 text-sm">
            <button className="underline underline-offset-4" onClick={() => setRunKey(runKey + 1)}>
              Restart preview
            </button>
            {["valid", "published"].includes(flow.status) && (
              <a className="underline underline-offset-4" href={`/f/${flow.id}`} target="_blank" rel="noreferrer" data-testid="public-link">
                Open public page
              </a>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--g-line)" }} data-testid="flow-preview">
            <FlowRenderer key={`${flow.id}-${runKey}`} spec={spec} tokens={tokens} />
          </div>
        </div>
      ) : (
        renderTab?.(tab, flow) ?? <p className="g-muted">Coming next.</p>
      )}
    </section>
  );
}
