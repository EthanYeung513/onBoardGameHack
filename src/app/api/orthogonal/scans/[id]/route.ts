import { NextResponse } from "next/server";
import { scanView } from "@/services/orthogonal/live";
import { isLiveId, requireUserId } from "@/services/orthogonal/session";
import { NotFoundError } from "@/services/errors";
import { handle } from "../../../http";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await requireUserId();
  if (user instanceof NextResponse) return user;
  return handle(async () => {
    if (!isLiveId(id)) throw new NotFoundError("Scan not found");
    return scanView(user, id);
  });
}
