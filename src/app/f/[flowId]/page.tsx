import { notFound } from "next/navigation";
import type { FlowSpec } from "@/lib/flow/spec";
import { DesignTokens } from "@/lib/schemas/tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PublicFlow } from "./PublicFlow";

export const dynamic = "force-dynamic";

// Public page for a generated flow. Its email step writes sign-ups to the leads table.
export default async function PublicFlowPage({ params }: { params: Promise<{ flowId: string }> }) {
  const { flowId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(flowId)) notFound();
  const db = supabaseAdmin();
  const flow = await db.from("flows").select("id, project_id, spec_json, status").eq("id", flowId).maybeSingle();
  if (!flow.data || !["valid", "published"].includes(flow.data.status)) notFound();
  const tokens = await db.from("design_tokens").select("tokens_json").eq("project_id", flow.data.project_id).order("version", { ascending: false }).limit(1).single();
  if (tokens.error) notFound();
  return (
    <main className="min-h-screen">
      <PublicFlow flowId={flowId} spec={flow.data.spec_json as FlowSpec} tokens={DesignTokens.parse(tokens.data.tokens_json)} />
    </main>
  );
}
