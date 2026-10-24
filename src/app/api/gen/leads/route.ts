import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Sign-ups captured by the email step of a generated flow. Public, so it validates strictly and only
// accepts flows that exist and passed validation.
const Body = z.object({
  flowId: z.string().uuid(),
  email: z.string().email().max(254),
  answers: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const db = supabaseAdmin();
  const flow = await db.from("flows").select("id, status").eq("id", parsed.data.flowId).maybeSingle();
  if (!flow.data || !["valid", "published"].includes(flow.data.status)) return NextResponse.json({ error: "This flow is not accepting sign-ups" }, { status: 404 });
  const answers = JSON.stringify(parsed.data.answers).length > 20_000 ? {} : parsed.data.answers;
  const ins = await db.from("leads").insert({ flow_id: parsed.data.flowId, email: parsed.data.email.toLowerCase(), answers_json: answers }).select("id").single();
  if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: ins.data.id }, { status: 201 });
}
