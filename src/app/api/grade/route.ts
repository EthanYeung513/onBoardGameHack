import { z } from "zod";
import { getDb } from "@/db/client";
import { getLlm } from "@/llm";
import { submitAnswer } from "@/services/grading";
import { retrieveCorrections } from "@/services/corrections";
import { handle } from "../http";

const body = z.object({
  learnerId: z.string().min(1),
  cardId: z.string().min(1),
  answerText: z.string().max(4000).optional(),
  choiceIdx: z.number().int().min(0).optional(),
});

export async function POST(req: Request) {
  return handle(async () => submitAnswer(await getDb(), getLlm(), body.parse(await req.json()), retrieveCorrections));
}
