"use client";
import { FlowRenderer } from "@/components/gen/flow/FlowRenderer";
import type { FlowSpec } from "@/lib/flow/spec";
import type { DesignTokens } from "@/lib/schemas/tokens";

export function PublicFlow({ flowId, spec, tokens }: { flowId: string; spec: FlowSpec; tokens: DesignTokens }) {
  return (
    <FlowRenderer
      spec={spec}
      tokens={tokens}
      onLead={(email, answers) => {
        void fetch("/api/gen/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ flowId, email, answers }) });
      }}
    />
  );
}
