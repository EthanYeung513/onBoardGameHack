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
  action: (fn, args) => http.action(fn, { ...args, secret } as never),
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

/** Jobs run at once (e.g. a fresh scan while another space's brain enriches in the background). */
const LANES = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 4));
console.log(`worker ${workerId}: stages [${stages.join(", ")}] · ${LANES} lanes · LLM ${llm.live ? "live (Mubit)" : "OFFLINE stand-ins"} · embeddings ${embed.mode}`);

const waiters = new Set<() => void>();
wake = () => {
  for (const w of [...waiters]) w();
};
const idle = () =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      waiters.delete(done);
      resolve();
    };
    const t = setTimeout(done, 2000); // retry backoff timers aren't reactive
    waiters.add(done);
  });

async function lane(n: number) {
  const id = `${workerId}#${n}`;
  while (!stopping) {
    try {
      // Lane 1 only takes scan jobs (when there is more than one lane): a manager waiting on a
      // scan never queues behind long background slices filling every lane.
      const claimed = await convex.mutation(api.pipeline.claim, { workerId: id, stages, scanOnly: LANES > 1 && n === 1 });
      if (claimed) {
        const outcome = await runSlice(claimed, { convex, llm, embed, workerId: id, registry });
        console.log(`worker: ${claimed.job.stage} (${claimed.job._id}) → ${outcome}`);
        continue;
      }
    } catch (err) {
      console.error("worker:", err instanceof Error ? err.message : err);
    }
    await idle();
  }
}
await Promise.all(Array.from({ length: LANES }, (_, i) => lane(i + 1)));
await live.close();
