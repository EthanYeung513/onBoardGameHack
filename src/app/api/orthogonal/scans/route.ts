import { NextResponse } from "next/server";
import { scanRequest } from "@/lib/orthogonal/schema";
import { kick, originOf } from "@/lib/pipeline/kick";
import { scanSite } from "@/services/orthogonal";
import { scanView, startScan } from "@/services/orthogonal/live";
import { requireUserId, liveBackend } from "@/services/orthogonal/session";
import { handle } from "../../http";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { url } = scanRequest.parse(await req.json().catch(() => ({})));
  if (!liveBackend(url)) return handle(async () => scanSite(url));
  const user = await requireUserId();
  if (user instanceof NextResponse) return user;
  return handle(async () => {
    const { id } = await startScan(user, url);
    kick(originOf(req), id);
    return scanView(user, id);
  });
}
