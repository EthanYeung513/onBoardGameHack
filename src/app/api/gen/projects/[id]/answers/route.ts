import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, HttpError, requireProject } from "@/lib/api/guard";
import { memory } from "@/lib/memory";
import { kick, originOf } from "@/lib/pipeline/kick";
import { releaseGate } from "@/lib/pipeline/runner";
import { supabaseAdmin } from "@/lib/supabase/admin";

const Body = z.object({ answers: z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(200)).max(10)])) });

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireProject(id);
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, "Answers were not in the expected format");
    const db = supabaseAdmin();
    const qs = await db.from("questions").select("question_key, prompt").eq("project_id", id);
    const prompts = new Map((qs.data ?? []).map((q) => [q.question_key, q.prompt]));
    const rows = Object.entries(parsed.data.answers)
      .filter(([k]) => prompts.has(k))
      .map(([k, v]) => ({ project_id: id, question_key: k, prompt: prompts.get(k), answer: v }));
    if (rows.length === 0) throw new HttpError(400, "Answer at least one question");
    const up = await db.from("answers").upsert(rows, { onConflict: "project_id,question_key" });
    if (up.error) throw new HttpError(500, up.error.message);
    await Promise.allSettled(rows.map((r) => memory.rememberDecision(id, "questions", { kind: "answer", what: `${r.prompt} Answer: ${Array.isArray(r.answer) ? r.answer.join(", ") : r.answer}` })));
    await releaseGate(id, "awaiting_answers");
    kick(originOf(request), id);
    return NextResponse.json({ ok: true, saved: rows.length });
  });
}
