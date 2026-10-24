import { NextResponse } from "next/server";
import { shipRequest } from "@/lib/orthogonal/schema";
import { pushProject } from "@/services/orthogonal";
import { isLiveId, liveBackend } from "@/services/orthogonal/session";
import { handle } from "../../../../http";

// Opening pull requests on the customer's repository is outside this MVP, so live projects get a
// clear refusal instead of a pretend success. The Lumen demo keeps its mock answer.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = shipRequest.parse(await req.json().catch(() => ({})));
  if (!liveBackend(body.siteUrl) || !isLiveId(id)) return handle(async () => pushProject(id, body));
  return NextResponse.json({ error: "GitHub pull requests are not connected yet. Publish instead, or export the component from the studio's Files tab." }, { status: 501 });
}
