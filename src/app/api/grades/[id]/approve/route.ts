import { z } from "zod";
import { getDb } from "@/db/client";
import { approveGrade } from "@/services/corrections";
import { getFeedbackSink } from "@/services/feedback";
import { handle } from "../../../http";

const body = z.object({ reviewer: z.string().min(1).max(100).default("Manager") });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const { reviewer } = body.parse(await req.json().catch(() => ({})));
    return approveGrade(await getDb(), getFeedbackSink(), id, reviewer);
  });
}
