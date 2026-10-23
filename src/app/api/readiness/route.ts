import { getDb } from "@/db/client";
import { getDefaultCompany } from "@/services/content";
import { getReadiness } from "@/services/reporting";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const db = await getDb();
    return getReadiness(db, (await getDefaultCompany(db)).id);
  });
}
