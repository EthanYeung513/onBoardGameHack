import { after, NextResponse, type NextRequest } from "next/server";
import { handle, requireProject } from "@/lib/api/guard";
import { kick, originOf } from "@/lib/pipeline/kick";
import { advance, pipelineSecret } from "@/lib/pipeline/runner";

export const maxDuration = 300;

// Runs one pipeline slice after responding, then schedules the next one.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const internal = request.headers.get("x-pipeline-secret") === pipelineSecret();
    if (!internal) await requireProject(id);
    const resume = request.nextUrl.searchParams.get("resume") === "1";
    const origin = originOf(request);
    after(async () => {
      try {
        const r = await advance(id, { resume });
        if (r.state === "continue") kick(origin, id);
        else if (r.state === "retry_scheduled") kick(origin, id, Math.min(r.retryInMs ?? 2000, 20_000));
      } catch (err) {
        console.error("advance failed", err);
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  });
}
