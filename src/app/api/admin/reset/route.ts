import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { resetAllowed, resetDemo } from "@/services/demo";
import { handle } from "../../http";

export async function POST(req: Request) {
  if (!resetAllowed(process.env, req.headers.get("x-demo-reset-key"))) {
    return NextResponse.json({ error: "Reset is disabled here. Set DEMO_RESET_KEY and send it as x-demo-reset-key." }, { status: 403 });
  }
  return handle(async () => resetDemo(await getDb()));
}
