import { getDb } from "@/db/client";
import { getDefaultCompany, listDocs } from "@/services/content";
import { handle } from "../http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const db = await getDb();
    return { docs: await listDocs(db, (await getDefaultCompany(db)).id) };
  });
}
