import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError } from "@/lib/api/guard";
import { normaliseUrl } from "@/lib/crawl/rank";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

// Finds a crawl of the same URL from the last 24 hours that can be reused.
export async function GET(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "Sign in required");
    const raw = request.nextUrl.searchParams.get("url") ?? "";
    const url = normaliseUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url) return NextResponse.json({ cached: null });
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const db = supabaseAdmin();
    const { data } = await db
      .from("projects")
      .select("id, created_at, jobs!inner(stage, status)")
      .eq("created_by", user.id)
      .eq("url", url)
      .eq("jobs.stage", "crawl")
      .eq("jobs.status", "succeeded")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);
    const hit = data?.[0];
    if (!hit) return NextResponse.json({ cached: null });
    const { count } = await db.from("crawl_pages").select("id", { count: "exact", head: true }).eq("project_id", hit.id).eq("status", "fetched");
    return NextResponse.json({ cached: { projectId: hit.id, createdAt: hit.created_at, pages: count ?? 0 } });
  });
}
