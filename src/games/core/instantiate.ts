import { z } from "zod";
import { catalog } from "../catalog";
import type { GameId, GameSpecDefinition } from "./types";

/** What an AI returns after choosing a game: the game's id and a spec for it. */
export const gameInstanceSchema = z.object({
  game: z.string().min(1).describe("The id of the chosen game"),
  spec: z.unknown().describe("The spec for that game, matching its schema"),
});
export type GameInstance = z.infer<typeof gameInstanceSchema>;

export type InstantiateResult =
  | { ok: true; game: GameId; spec: unknown; definition: GameSpecDefinition<unknown> }
  | { ok: false; errors: string[] };

const formatIssues = (error: z.ZodError) =>
  error.issues.slice(0, 10).map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);

export function findGame(id: string, games: GameSpecDefinition<unknown>[] = catalog): GameSpecDefinition<unknown> | undefined {
  return games.find((g) => g.id === id);
}

/**
 * Turns untrusted AI output into a playable game, or readable errors to send back to the model for a retry.
 * Accepts the object or its JSON text.
 */
export function instantiateGame(input: unknown, games: GameSpecDefinition<unknown>[] = catalog): InstantiateResult {
  let value = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return { ok: false, errors: ["Input is not valid JSON"] };
    }
  }
  const envelope = gameInstanceSchema.safeParse(value);
  if (!envelope.success) return { ok: false, errors: formatIssues(envelope.error) };
  const definition = findGame(envelope.data.game, games);
  if (!definition) return { ok: false, errors: [`Unknown game "${envelope.data.game}". Available: ${games.map((g) => g.id).join(", ") || "none"}`] };
  const spec = definition.schema.safeParse(envelope.data.spec);
  if (!spec.success) return { ok: false, errors: formatIssues(spec.error).map((e) => `spec.${e}`) };
  return { ok: true, game: definition.id, spec: spec.data, definition };
}

export interface CatalogPromptEntry {
  id: GameId;
  name: string;
  bestFor: string;
  authoringTips: string[];
  jsonSchema: unknown;
}

/** The catalog as the AI should see it when picking a game and writing its spec. */
export function gameCatalogForPrompt(games: GameSpecDefinition<unknown>[] = catalog): CatalogPromptEntry[] {
  return games.map((g) => ({
    id: g.id,
    name: g.name,
    bestFor: g.bestFor,
    authoringTips: g.authoringTips,
    jsonSchema: z.toJSONSchema(g.schema, { io: "input" }),
  }));
}
