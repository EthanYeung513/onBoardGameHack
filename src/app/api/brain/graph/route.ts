import { loadGraph } from "@/lib/brain/route";

/** GET /api/brain/graph?space=<id> → `{nodes, edges}` shaped for cosmos.gl (BUILD-CONTRACT "Brain contract"). */
export async function GET(request: Request) {
  const result = await loadGraph(request);
  if (!result.ok) return result.response;
  return Response.json(result.graph, { headers: { "Cache-Control": "no-store" } });
}
