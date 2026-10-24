import { shipRequest } from "@/lib/orthogonal/schema";
import { publishProject } from "@/services/orthogonal";
import { handle } from "../../../../http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => publishProject(id, shipRequest.parse(await req.json())));
}
