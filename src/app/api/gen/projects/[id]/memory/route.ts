import { NextResponse } from "next/server";
import { handle, requireProject } from "@/lib/api/guard";
import { memoryProvider } from "@/lib/memory";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireProject(id);
    const db = supabaseAdmin();
    const [events, items, lessons] = await Promise.all([
      db.from("memory_events").select().eq("project_id", id).order("id", { ascending: false }).limit(200),
      db.from("memory_items").select("id, kind, agent_id, content, source_url, created_at").eq("project_id", id).order("created_at", { ascending: false }).limit(300),
      db.from("memory_items").select("id, kind, content, created_at").eq("scope", "global").order("created_at", { ascending: false }).limit(20),
    ]);
    return NextResponse.json({ provider: memoryProvider().name, events: events.data ?? [], items: items.data ?? [], lessons: lessons.data ?? [] });
  });
}
