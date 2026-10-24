import { DesignTokens } from "@/lib/schemas/tokens";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { exportFiles } from "./export";
import { specDiff } from "./patch";
import type { FlowSpec } from "./spec";

// Every accepted change is a new row in `flows` with its parent, a diff and regenerated files,
// so any version can be inspected, compared or restored.

export async function saveVersion(opts: { flowId: string; spec: FlowSpec; action: string; summary: string }) {
  const db = supabaseAdmin();
  const cur = await db.from("flows").select("id, project_id, variant_key, version, spec_json").eq("id", opts.flowId).single();
  if (cur.error) throw new Error(cur.error.message);
  const latest = await db.from("flows").select("version").eq("project_id", cur.data.project_id).eq("variant_key", cur.data.variant_key).order("version", { ascending: false }).limit(1).single();
  const version = (latest.data?.version ?? cur.data.version) + 1;
  const diff = specDiff(cur.data.spec_json as FlowSpec, opts.spec, `v${cur.data.version}`, `v${version}`);
  const ins = await db
    .from("flows")
    .insert({ project_id: cur.data.project_id, variant_key: cur.data.variant_key, version, spec_json: opts.spec, status: "valid", created_by_action: opts.action, parent_id: cur.data.id, diff: { patch: diff, summary: opts.summary } })
    .select("id, version")
    .single();
  if (ins.error) throw new Error(ins.error.message);
  await db.from("flows").update({ status: "superseded" }).eq("project_id", cur.data.project_id).eq("variant_key", cur.data.variant_key).lt("version", version).in("status", ["valid", "draft"]);
  const tokens = await db.from("design_tokens").select("tokens_json").eq("project_id", cur.data.project_id).order("version", { ascending: false }).limit(1).single();
  if (!tokens.error) {
    const files = exportFiles(opts.spec, DesignTokens.parse(tokens.data.tokens_json));
    await db.from("generated_files").insert(files.map((f) => ({ project_id: cur.data.project_id, flow_id: ins.data.id, path: f.path, content: f.content, version })));
  }
  return { id: ins.data.id as string, version, diff, projectId: cur.data.project_id as string, variantKey: cur.data.variant_key as string };
}

/** Latest version of a variant, given any version's id. */
export async function latestFlow(flowId: string) {
  const db = supabaseAdmin();
  const f = await db.from("flows").select("project_id, variant_key").eq("id", flowId).single();
  if (f.error) throw new Error(f.error.message);
  const latest = await db.from("flows").select().eq("project_id", f.data.project_id).eq("variant_key", f.data.variant_key).order("version", { ascending: false }).limit(1).single();
  if (latest.error) throw new Error(latest.error.message);
  return latest.data as { id: string; project_id: string; variant_key: string; version: number; spec_json: FlowSpec; status: string; parent_id: string | null; diff: { patch: string; summary: string } | null; created_by_action: string };
}
