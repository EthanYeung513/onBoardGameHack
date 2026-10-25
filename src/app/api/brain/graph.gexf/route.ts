import { toGexf } from "@/lib/brain/gexf";
import { loadGraph } from "@/lib/brain/route";

/** GET /api/brain/graph.gexf?space=<id> → GEXF 1.3 download for offline Gephi review. */
export async function GET(request: Request) {
  const result = await loadGraph(request);
  if (!result.ok) return result.response;
  const xml = toGexf(result.graph, { title: `${result.spaceName} brain` });
  const file = `${result.spaceName.replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase() || "space"}-brain.gexf`;
  return new Response(xml, {
    headers: {
      "Content-Type": "application/gexf+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
