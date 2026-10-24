import { z } from "zod";
import { complete, completeJson } from "@/lib/llm/client";

async function main() {
  const ctx = { projectId: "selftest", task: "selftest", log: (l: string, m: string, d?: unknown) => console.log(l, m, JSON.stringify(d)) };
  const a = await complete({ max_tokens: 300, system: "You answer in one sentence.", messages: [{ role: "user", content: "Say hello to the onboarding generator." }] }, ctx);
  console.log("text:", a.text);
  const b = await completeJson(z.object({ colors: z.array(z.string()), mood: z.string() }), { max_tokens: 800, system: "You describe brand palettes.", messages: [{ role: "user", content: "Give three hex colours for a calm library themed AI brand." }] }, ctx);
  console.log("json:", b);
}
main().catch((e) => { console.error(e); process.exit(1); });
