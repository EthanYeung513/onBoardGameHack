import { catalog } from "@/games/catalog";
import { handle } from "../http";

/** The installed games, as a dashboard needs to see them: which game to offer for which course content. */
export async function GET() {
  return handle(async () => ({
    games: catalog.map((g) => ({ id: g.id, name: g.name, description: g.description, bestFor: g.bestFor })),
  }));
}
