import { NextResponse, type NextRequest } from "next/server";
import { handle, requireProject } from "@/lib/api/guard";
import { originOf } from "@/lib/pipeline/kick";
import { after } from "next/server";
import { advance } from "@/lib/pipeline/runner";
import { kick } from "@/lib/pipeline/kick";

export const maxDuration = 300;

// Retry after a failure, or resume after a stall. Stages are idempotent, so this is always safe.
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireProject(id);
    const origin = originOf(request);
    after(async () => {
      const r = await advance(id, { resume: true });
      if (r.state === "continue") kick(origin, id);
      else if (r.state === "retry_scheduled") kick(origin, id, Math.min(r.retryInMs ?? 2000, 20_000));
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  });
}
