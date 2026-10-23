import { getDb } from "@/db/client";
import { getReviewQueue } from "@/services/review";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => getReviewQueue(await getDb()));
}
