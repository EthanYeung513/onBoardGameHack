import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// Shared by GET /api/brain/graph and /api/brain/graph.gexf: the caller's Convex Auth token is
// forwarded so `brain.graph` runs its own requireRole check; ConvexError codes become HTTP statuses.

async function fetchGraph(spaceId: Id<"spaces">, token: string) {
  const [graph, space] = await Promise.all([
    fetchQuery(api.brain.graph, { spaceId }, { token }),
    fetchQuery(api.spaces.get, { spaceId }, { token }),
  ]);
  return { graph, spaceName: space.name };
}

export type GraphResult =
  | ({ ok: true } & Awaited<ReturnType<typeof fetchGraph>>)
  | { ok: false; response: Response };

const error = (status: number, message: string) => ({ ok: false as const, response: Response.json({ error: message }, { status }) });

export async function loadGraph(request: Request): Promise<GraphResult> {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return error(503, "Convex is not configured — run `npm run dev`.");
  const spaceId = new URL(request.url).searchParams.get("space");
  if (!spaceId) return error(422, "Missing ?space=<id>");
  const token = await convexAuthNextjsToken();
  if (!token) return error(401, "Sign in required");
  try {
    return { ok: true, ...(await fetchGraph(spaceId as Id<"spaces">, token)) };
  } catch (err) {
    if (err instanceof ConvexError) {
      const { code, message } = err.data as { code?: number; message?: string };
      return error(typeof code === "number" ? code : 500, message ?? "Request failed");
    }
    // A string that isn't a valid `spaces` id fails argument validation.
    if (err instanceof Error && /ArgumentValidationError|does not match validator|not a valid ID/i.test(err.message)) {
      return error(404, "Space not found");
    }
    throw err;
  }
}
