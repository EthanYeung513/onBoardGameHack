import { z } from "zod";
import { getDb } from "@/db/client";
import { getBossDeck } from "@/services/adaptive";
import { getTrainerDeck } from "@/services/world";
import { handle } from "../../../http";

export const dynamic = "force-dynamic";

const query = z.object({ learnerId: z.string().min(1), kind: z.enum(["trainer", "boss"]).default("trainer") });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => {
    const params = new URL(req.url).searchParams;
    const { learnerId, kind } = query.parse({ learnerId: params.get("learnerId"), kind: params.get("kind") ?? undefined });
    const db = await getDb();
    return { cards: kind === "boss" ? await getBossDeck(db, learnerId, id) : await getTrainerDeck(db, id) };
  });
}
