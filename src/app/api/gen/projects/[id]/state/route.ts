import { NextResponse } from "next/server";
import { handle, requireProject } from "@/lib/api/guard";
import { projectState } from "@/lib/pipeline/state";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    await requireProject(id);
    return NextResponse.json(await projectState(id));
  });
}
