import { scanRequest } from "@/lib/orthogonal/schema";
import { scanSite } from "@/services/orthogonal";
import { handle } from "../../http";

export async function POST(req: Request) {
  return handle(async () => scanSite(scanRequest.parse(await req.json()).url));
}
