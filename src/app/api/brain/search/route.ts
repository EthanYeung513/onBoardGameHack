import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { ConvexError } from "convex/values";
import type { NextRequest } from "next/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createEmbedder } from "@/worker/providers/embed";

// GET /api/brain/search?space=<id>&q=<text> (F17, BUILD-CONTRACT "Brain contract"): embeds the query
// with the same embedder the pipeline used for the chunks, then runs `search.search` (hybrid BM25 +
// vector + 1-hop graph) as the signed-in manager. `embeddings: "offline"` is reported when the
// hashed stand-in was used.

export async function GET(request: NextRequest) {
  const space = request.nextUrl.searchParams.get("space");
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!space) return Response.json({ error: "space is required" }, { status: 422 });
  const token = await convexAuthNextjsToken();
  if (!token) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const embedder = createEmbedder();
    const [vector] = q ? await embedder.embed([q]) : [undefined];
    const result = await fetchAction(api.search.search, { spaceId: space as Id<"spaces">, q, vector }, { token });
    return Response.json({ ...result, embeddings: embedder.mode });
  } catch (err) {
    if (err instanceof ConvexError) {
      const { code, message } = err.data as { code: number; message: string };
      return Response.json({ error: message }, { status: code ?? 500 });
    }
    return Response.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 500 });
  }
}
