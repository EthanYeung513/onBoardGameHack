import { z } from "zod";
import { getDb } from "@/db/client";
import { getLlm } from "@/llm";
import { getDefaultCompany } from "@/services/content";
import { uploadPack } from "@/services/refresh";
import { handle } from "../http";

// Generating a gym makes several LLM calls; give it room on serverless hosts.
export const maxDuration = 120;

const body = z.object({
  title: z.string().min(1).max(80),
  role: z.string().max(60).nullable().default(null),
  markdown: z.string().min(20).max(100_000),
  gymName: z.string().max(60).optional(),
  leaderName: z.string().max(60).optional(),
  publish: z.boolean().default(true),
});

export async function POST(req: Request) {
  return handle(async () => {
    const input = body.parse(await req.json());
    const db = await getDb();
    const { gym, cards } = await uploadPack(db, getLlm(), { ...input, companyId: (await getDefaultCompany(db)).id });
    return { gym: { id: gym.id, name: gym.name, building: gym.building, locked: gym.locked }, cards: cards.length };
  });
}
