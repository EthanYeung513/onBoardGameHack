import { buildRequest } from "@/lib/orthogonal/schema";
import { buildProject } from "@/services/orthogonal";
import { handle } from "../../http";

export async function POST(req: Request) {
  return handle(async () => buildProject(buildRequest.parse(await req.json())));
}
