import { NextResponse } from "next/server";
import { handle, HttpError, requireProject } from "@/lib/api/guard";
import { validateFlowSpec } from "@/lib/flow/spec";
import { latestFlow, saveVersion } from "@/lib/flow/versions";
import { safeMemory } from "@/lib/memory";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Undo or roll back: restores the given version's spec as a new version, so history is kept.
export async function POST(request: Request, ctx: { params: Promise<{ flowId: string }> }) {
  return handle(async () => {
    const { flowId } = await ctx.params;
    const { reason } = (await request.json().catch(() => ({}))) as { reason?: "undo" | "rollback" };
    const db = supabaseAdmin();
    const target = await db.from("flows").select("id, project_id, variant_key, version, spec_json").eq("id", flowId).single();
    if (target.error) throw new HttpError(404, "Version not found");
    await requireProject(target.data.project_id);
    const latest = await latestFlow(flowId);
    if (latest.id === target.data.id) throw new HttpError(400, "That is already the current version");
    const v = validateFlowSpec(target.data.spec_json);
    if (!v.ok) throw new HttpError(400, `That version no longer validates: ${v.errors[0]}`);
    const action = reason === "undo" ? "undo" : "rollback";
    const saved = await saveVersion({ flowId: latest.id, spec: v.spec, action, summary: `Restored version ${target.data.version}` });
    await safeMemory.recordOutcome(target.data.project_id, "chat", {
      kind: action === "undo" ? "change_undone" : "change_rejected",
      detail: `${target.data.variant_key}: user ${action === "undo" ? "undid" : "rolled back"} version ${latest.version} (${latest.diff?.summary ?? latest.created_by_action}) to version ${target.data.version}`,
      success: false,
    });
    return NextResponse.json({ ok: true, version: saved.version, id: saved.id });
  });
}
