import { NextResponse } from "next/server";
import { handle, requireProject } from "@/lib/api/guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

// All versions of a flow's variant with their files, newest first.
export async function GET(_: Request, ctx: { params: Promise<{ flowId: string }> }) {
  return handle(async () => {
    const { flowId } = await ctx.params;
    const db = supabaseAdmin();
    const f = await db.from("flows").select("project_id, variant_key").eq("id", flowId).single();
    if (f.error) return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    await requireProject(f.data.project_id);
    const versions = await db.from("flows").select("id, version, status, created_by_action, created_at, diff, parent_id").eq("project_id", f.data.project_id).eq("variant_key", f.data.variant_key).order("version", { ascending: false });
    const ids = (versions.data ?? []).map((v) => v.id);
    const files = await db.from("generated_files").select("flow_id, path, content, version").in("flow_id", ids);
    const chat = await db.from("chat_messages").select("role, content, tool_calls, created_at").eq("project_id", f.data.project_id).in("flow_id", ids).order("created_at");
    return NextResponse.json({ versions: versions.data ?? [], files: files.data ?? [], chat: chat.data ?? [] });
  });
}
