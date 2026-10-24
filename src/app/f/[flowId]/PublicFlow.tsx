"use client";
import { FlowRenderer } from "@/components/gen/flow/FlowRenderer";
import type { FlowSpec } from "@/lib/flow/spec";
import type { DesignTokens } from "@/lib/schemas/tokens";

export function PublicFlow({ flowId, spec, tokens }: { flowId: string; spec: FlowSpec; tokens: DesignTokens }) {
  return (
    <FlowRenderer
      className="w-full overflow-hidden rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,.12)]"
      spec={spec}
      tokens={tokens}
      onLead={(email, answers) => {
        void fetch("/api/gen/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flowId, email, answers }) });
      }}
    />
  );
}
