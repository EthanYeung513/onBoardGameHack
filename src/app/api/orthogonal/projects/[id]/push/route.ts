import { shipRequest } from "@/lib/orthogonal/schema";
import { pushProject } from "@/services/orthogonal";
import { handle } from "../../../../http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => pushProject(id, shipRequest.parse(await req.json())));
}
