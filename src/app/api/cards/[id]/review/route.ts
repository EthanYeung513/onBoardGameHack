import { z } from "zod";
import { getDb } from "@/db/client";
import { reviewCard } from "@/services/review";
import { handle } from "../../../http";

const body = z.object({
  action: z.enum(["approve", "edit", "reject"]),
  reviewer: z.string().min(1).max(100).default("Manager"),
  edits: z
    .object({
      prompt: z.string().min(1).optional(),
      choices: z.array(z.string().min(1)).min(2).max(6).optional(),
      answerIdx: z.number().int().min(0).optional(),
      expertAnswer: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const input = body.parse(await req.json());
    return reviewCard(await getDb(), id, input.action, input.reviewer, input.edits);
  });
}
