import { getDb } from "@/db/client";
import { getLlm } from "@/llm";
import { regenerateStale } from "@/services/refresh";
import { handle } from "../../../http";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const { regenerated, retired } = await regenerateStale(await getDb(), getLlm(), id);
    return { regenerated, retired };
  });
}
