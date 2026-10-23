import { z } from "zod";
import { getDb } from "@/db/client";
import { awardBadge } from "@/services/world";
import { handle } from "../http";

const body = z.object({ learnerId: z.string().min(1), gymId: z.string().min(1) });

export async function POST(req: Request) {
  return handle(async () => {
    const { learnerId, gymId } = body.parse(await req.json());
    return awardBadge(await getDb(), learnerId, gymId);
  });
}
