import { NextResponse } from "next/server";
import { buildRequest } from "@/lib/orthogonal/schema";
import { kick, originOf } from "@/lib/pipeline/kick";
import { buildProject } from "@/services/orthogonal";
import { projectView, startBuild } from "@/services/orthogonal/live";
import { isLiveId, requireUserId, liveBackend } from "@/services/orthogonal/session";
import { handle } from "../../http";

export const maxDuration = 60;

export async function POST(req: Request) {
  const body = buildRequest.parse(await req.json().catch(() => ({})));
  if (!liveBackend(body.siteUrl) || !isLiveId(body.scanId)) return handle(async () => buildProject(body));
  const user = await requireUserId();
  if (user instanceof NextResponse) return user;
  return handle(async () => {
    const { id } = await startBuild(user, body);
    kick(originOf(req), id);
    return projectView(user, id);
  });
}
