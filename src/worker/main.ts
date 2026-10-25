import { ConvexClient, ConvexHttpClient } from "convex/browser";
import { hostname } from "node:os";
import { api } from "@convex/_generated/api";
import { createEmbedder } from "./providers/embed";
import { createLlm } from "./providers/llm";
import { registeredStages, registry } from "./registry";
import { runSlice } from "./runner";
import type { WorkerConvex } from "./types";

// `npm run worker` (started by `npm run dev`; on Modal in production). Claims queued pipeline
// jobs from Convex and runs them one slice at a time. Wakes on a live subscription to the queue.

const url = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.WORKER_SECRET;
if (!url || !secret) {
  console.error("worker: NEXT_PUBLIC_CONVEX_URL and WORKER_SECRET must be set (npm run dev writes both to .env.local)");
  process.exit(1);
}

const http = new ConvexHttpClient(url);
const convex: WorkerConvex = {
  query: (fn, args) => http.query(fn, { ...args, secret } as never),
  mutation: (fn, args) => http.mutation(fn, { ...args, secret } as never),
};
const workerId = `${hostname()}:${process.pid}`;
const llm = createLlm();
const embed = createEmbedder();
const stages = registeredStages();

let wake: (() => void) | null = null;
const live = new ConvexClient(url);
live.onUpdate(api.pipeline.pending, { secret }, () => wake?.(), (err) => console.error("worker: subscription error", err.message));

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => ((stopping = true), wake?.()));

console.log(`worker ${workerId}: stages [${stages.join(", ")}] · LLM ${llm.live ? "live (Mubit)" : "OFFLINE stand-ins"} · embeddings ${embed.mode}`);
while (!stopping) {
  try {
    const claimed = await convex.mutation(api.pipeline.claim, { workerId, stages });
    if (claimed) {
      const outcome = await runSlice(claimed, { convex, llm, embed, workerId, registry });
      console.log(`worker: ${claimed.job.stage} (${claimed.job._id}) → ${outcome}`);
      continue;
    }
  } catch (err) {
    console.error("worker:", err instanceof Error ? err.message : err);
  }
  // Idle: wait for the queue to change, or 2 s (retry backoff timers aren't reactive).
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 2000);
    wake = () => (clearTimeout(t), resolve());
  });
  wake = null;
}
await live.close();
