import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getXapiStatements } from "@/services/reporting";
import { handle } from "../http";

export const dynamic = "force-dynamic";

/** xAPI statements for one learner, downloadable as JSON for import into an LRS. */
export async function GET(req: Request) {
  const learnerId = new URL(req.url).searchParams.get("learnerId");
  const parsed = z.string().min(1).safeParse(learnerId);
  if (!parsed.success) return handle(async () => z.string().min(1).parse(learnerId));
  try {
    const statements = await getXapiStatements(await getDb(), parsed.data);
    return new NextResponse(JSON.stringify(statements, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="xapi-${parsed.data}.json"` },
    });
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }
}
