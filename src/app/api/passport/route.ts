import { z } from "zod";
import { getDb } from "@/db/client";
import { getPassport } from "@/services/reporting";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => getPassport(await getDb(), z.string().min(1).parse(new URL(req.url).searchParams.get("learnerId"))));
}
