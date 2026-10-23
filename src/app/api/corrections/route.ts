import { z } from "zod";
import { getDb } from "@/db/client";
import { getLlm } from "@/llm";
import { createCorrection } from "@/services/corrections";
import { getFeedbackSink } from "@/services/feedback";
import { handle } from "../http";

const body = z.object({
  gradeId: z.string().min(1),
  correctedScores: z.record(z.string(), z.number().int().min(0).max(3)),
  reason: z.string().min(1).max(500),
  reviewer: z.string().min(1).max(100).default("Manager"),
});

export async function POST(req: Request) {
  return handle(async () => createCorrection(await getDb(), getLlm(), getFeedbackSink(), body.parse(await req.json())));
}
