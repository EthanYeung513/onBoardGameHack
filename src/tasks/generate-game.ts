import { gameCatalogForPrompt, instantiateGame } from "@/games/core/instantiate";
import type { GameId } from "@/games/core/types";
import type { ChatResult, LlmClient } from "@/llm/types";
import { TASKS } from "./registry";

/** One document section from a course, as the game designer should see it. */
export interface GameSection {
  doc: string;
  heading: string;
  text: string;
}

export interface GenerateGameInput {
  packTitle: string;
  role: string | null;
  /** Require this game; unset lets the model pick the best fit for the content. */
  game?: GameId;
  /** The player character's name shown in dialogue, if the course knows it. */
  playerName?: string;
  sections: GameSection[];
}

export function buildGameUserMessage(input: GenerateGameInput): string {
  const sections = input.sections
    .map((s) => `### ${s.doc} > ${s.heading}\n\n${s.text}`)
    .join("\n\n");
  return [
    `## Course\n${input.packTitle}${input.role ? ` (role: ${input.role})` : ""}`,
    input.playerName ? `## Player\n${input.playerName}` : null,
    input.game ? `## Required game\n${input.game}` : null,
    `## Course sections\n\n${sections}`,
    `## Installed games\n${JSON.stringify(gameCatalogForPrompt(), null, 2)}`,
  ]
    .filter((part) => part != null)
    .join("\n\n");
}

export class GenerateGameError extends Error {}

/**
 * Picks a game and writes its spec from the course sections. An invalid reply is retried once with the
 * validator's errors, the same retry loop the card generator uses; a second failure throws.
 */
export async function generateGameSpec(
  llm: LlmClient,
  model: string,
  input: GenerateGameInput,
): Promise<{ game: GameId; spec: unknown; call: ChatResult }> {
  const user = buildGameUserMessage(input);
  let call = await llm.chat({ task: "generate-game", model, system: TASKS["generate-game"].system, user, meta: input });
  let result = instantiateGame(call.content);
  if (!result.ok || (input.game && result.game !== input.game)) {
    const errors = !result.ok ? result.errors : [`asked for game "${input.game}", got "${result.game}"`];
    call = await llm.chat({
      task: "generate-game",
      model,
      system: TASKS["generate-game"].system,
      user: `${user}\n\n## Note\nYour previous reply was rejected: ${errors.join("; ")}. Reply again with valid JSON only.`,
      meta: input,
    });
    result = instantiateGame(call.content);
    if (!result.ok || (input.game && result.game !== input.game)) {
      const retryErrors = !result.ok ? result.errors : [`asked for game "${input.game}", got "${result.game}"`];
      throw new GenerateGameError(`Generated game spec invalid after retry: ${retryErrors.join("; ")}`);
    }
  }
  return { game: result.game, spec: result.spec, call };
}
