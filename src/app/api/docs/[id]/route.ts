import { z } from "zod";
import { getDb } from "@/db/client";
import { getDoc } from "@/services/content";
import { updateDoc } from "@/services/refresh";
import { handle } from "../../http";

export const dynamic = "force-dynamic";

const body = z.object({ body: z.string().min(1).max(100_000) });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => getDoc(await getDb(), id));
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(async () => updateDoc(await getDb(), id, body.parse(await req.json()).body));
}
