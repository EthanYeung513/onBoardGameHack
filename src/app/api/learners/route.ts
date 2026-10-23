import { z } from "zod";
import { getDb } from "@/db/client";
import { joinCompany } from "@/services/world";
import { handle } from "../http";

const body = z.object({
  joinCode: z.string().min(1).max(20),
  name: z.string().min(1).max(40),
  role: z.string().min(1).max(60),
});

export async function POST(req: Request) {
  return handle(async () => joinCompany(await getDb(), body.parse(await req.json())));
}
