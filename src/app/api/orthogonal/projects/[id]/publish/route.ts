import { NextResponse } from "next/server";
import { shipRequest } from "@/lib/orthogonal/schema";
import { originOf } from "@/lib/pipeline/kick";
import { publishProject } from "@/services/orthogonal";
import { publishLive } from "@/services/orthogonal/live";
import { isLiveId, requireUserId, liveBackend } from "@/services/orthogonal/session";
import { handle } from "../../../../http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = shipRequest.parse(await req.json().catch(() => ({})));
  if (!liveBackend(body.siteUrl) || !isLiveId(id)) return handle(async () => publishProject(id, body));
  const user = await requireUserId();
  if (user instanceof NextResponse) return user;
  return handle(async () => publishLive(user, id, body, originOf(req)));
}
