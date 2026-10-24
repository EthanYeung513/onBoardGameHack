import { z } from "zod";
import { getDb } from "@/db/client";
import { findGame } from "@/games/core/instantiate";
import type { GameId } from "@/games/core/types";
import { getLlm } from "@/llm";
import { generateGameForPack } from "@/services/games";
import { BadRequestError } from "@/services/errors";
import { handle } from "../../http";

// Generating a game makes one or two LLM calls; give it room on serverless hosts.
export const maxDuration = 120;

const body = z.object({
  packId: z.string().min(1),
  /** Require this game; omitted lets the model pick the best fit for the course content. */
  game: z.string().min(1).optional(),
  playerName: z.string().max(18).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const input = body.parse(await req.json());
    if (input.game && !findGame(input.game)) throw new BadRequestError(`Unknown game "${input.game}"`);
    const result = await generateGameForPack(await getDb(), getLlm(), { ...input, game: input.game as GameId | undefined });
    return { game: result.game, spec: result.spec, packId: result.packId, sectionsUsed: result.sectionsUsed, requestId: result.requestId };
  });
}
