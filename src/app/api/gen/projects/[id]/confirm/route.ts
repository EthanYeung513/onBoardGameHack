import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireProject } from "@/lib/api/guard";
import { memory } from "@/lib/memory";
import { kick, originOf } from "@/lib/pipeline/kick";
import { releaseGate } from "@/lib/pipeline/runner";
import { ProjectModel } from "@/lib/schemas/project-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

// Stores the edited and confirmed project model as a new version, then continues the pipeline.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireProject(id);
    const body = await request.json();
    const parsed = ProjectModel.safeParse(body.model);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const db = supabaseAdmin();
    const last = await db.from("project_models").select("version, model_json").eq("project_id", id).order("version", { ascending: false }).limit(1).single();
    const version = (last.data?.version ?? 0) + 1;
    const ins = await db.from("project_models").insert({ project_id: id, version, model_json: parsed.data, confirmed_at: new Date().toISOString() });
    if (ins.error) throw new HttpError(500, ins.error.message);

    const m = parsed.data;
    const edited = JSON.stringify(last.data?.model_json) !== JSON.stringify(m);
    await Promise.allSettled([
      memory.rememberSiteFacts(id, "analyse", [
        { content: `${m.companyName}: ${m.productSummary}` },
        { content: `Audience: ${m.targetAudience.join("; ")}` },
        { content: `Tone of voice: ${m.toneOfVoice.adjectives.join(", ")}. ${m.toneOfVoice.description}` },
        { content: `Getting started: ${m.gettingStarted.summary}. Success moment: ${m.gettingStarted.successMoment}` },
        ...m.features.map((f) => ({ content: `Feature ${f.name}: ${f.description}`, sourceUrl: f.sourceUrls[0] })),
      ]),
      memory.rememberDecision(id, "review", { kind: "model_confirmed", what: `Confirmed the project model (version ${version})`, why: edited ? "The team edited the findings before confirming" : "Findings accepted as found" }),
    ]);
    await releaseGate(id, "awaiting_confirmation");
    kick(originOf(request), id);
    return NextResponse.json({ ok: true, version });
  });
}
