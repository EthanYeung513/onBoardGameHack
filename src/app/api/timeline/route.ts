import { getDb } from "@/db/client";
import { getLlm } from "@/llm";
import { getFeedbackSink } from "@/services/feedback";
import { getTimeline } from "@/services/timeline";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => ({ ...(await getTimeline(await getDb())), mode: getLlm().mode, feedbackSink: getFeedbackSink().name }));
}
