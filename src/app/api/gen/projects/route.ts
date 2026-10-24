import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, HttpError } from "@/lib/api/guard";
import { normaliseUrl } from "@/lib/crawl/rank";
import { kick, originOf } from "@/lib/pipeline/kick";
import { ensureJob } from "@/lib/pipeline/runner";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";

const Body = z.object({ url: z.string().min(3), useCachedFrom: z.string().uuid().optional() });

export async function POST(request: NextRequest) {
  return handle(async () => {
    const user = await currentUser();
    if (!user) throw new HttpError(401, "Sign in required");
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Enter a website address");
    const raw = parsed.data.url.trim();
    const url = normaliseUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!url) throw new HttpError(400, "That does not look like a website address");
    const db = supabaseAdmin();
    let reuse: string | null = null;
    if (parsed.data.useCachedFrom) {
      const src = await db.from("projects").select("id, created_by, url").eq("id", parsed.data.useCachedFrom).single();
      if (src.data && src.data.created_by === user.id && src.data.url === url) reuse = src.data.id;
    }
    const ins = await db.from("projects").insert({ url, created_by: user.id, status: "queued", stage: "crawl", reused_crawl_from: reuse }).select().single();
    if (ins.error) throw new HttpError(500, ins.error.message);
    await ensureJob(db, ins.data.id, "crawl");
    kick(originOf(request), ins.data.id);
    return NextResponse.json({ project: ins.data }, { status: 201 });
  });
}
