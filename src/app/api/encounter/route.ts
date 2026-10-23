import { z } from "zod";
import { getDb } from "@/db/client";
import { getEncounterCard } from "@/services/world";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const learnerId = z.string().min(1).parse(new URL(req.url).searchParams.get("learnerId"));
    return { card: await getEncounterCard(await getDb(), learnerId) };
  });
}
