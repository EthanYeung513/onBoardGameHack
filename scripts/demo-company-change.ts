// Demo: "the company changed". Edits one sentence of a website page this space has crawled and
// re-ingests it through the same path a re-scan uses (ingestDocument → diff event → cascade).
// Mubit's loop then does the rest for real: facts citing the old text go stale, the courses that
// teach them get those steps rewritten and marked "New", and the manager sees "Update courses".
//
//   npm run demo:change -- <spaceId> "<text on the page>" "<replacement>"
//   e.g. npm run demo:change -- p17578… '$16 per user' '$18 per user'
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { createEmbedder } from "@/worker/providers/embed";
import { ingestDocument } from "@/worker/ingest";
import type { WorkerConvex } from "@/worker/types";

const [spaceId, find, replace] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const secret = process.env.WORKER_SECRET;
if (!spaceId || !find || replace === undefined || !url || !secret) {
  console.error('usage: npm run demo:change -- <spaceId> "<text on the page>" "<replacement>"  (needs .env.local: NEXT_PUBLIC_CONVEX_URL, WORKER_SECRET)');
  process.exit(1);
}
const http = new ConvexHttpClient(url);
const convex = {
  query: (fn: never, args: object) => http.query(fn, { ...args, secret } as never),
  mutation: (fn: never, args: object) => http.mutation(fn, { ...args, secret } as never),
  action: (fn: never, args: object) => http.action(fn, { ...args, secret } as never),
} as unknown as WorkerConvex;

const page = await convex.query(api.ingest.findCrawledPage, { spaceId: spaceId as Id<"spaces">, contains: find });
if (!page) {
  console.error(`No crawled page of ${spaceId} contains "${find}".`);
  process.exit(1);
}
const res = await ingestDocument(
  { convex, embed: createEmbedder(), space: { _id: spaceId as Id<"spaces"> } as never },
  { connectorId: page.connectorId, kind: "page", externalId: page.url, url: page.url, title: page.title, text: page.text.split(find).join(replace), meta: { demo: "company-change" } },
);
await convex.mutation(api.ingest.queueCascade, { spaceId: spaceId as Id<"spaces"> });
console.log(`${page.url}: ${res.status} (${res.chunks} chunks). Cascade queued: watch the dashboard for "Update courses".`);
