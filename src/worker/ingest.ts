import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { chunkText, contentHash } from "./chunk";
import type { StageContext } from "./types";

// Shared by every source (crawl, files, GitHub, Nango tools): normalised text in → versioned
// `source_items` + embedded `doc_chunks`, with diff_events/stale cascade handled by convex/ingest.

export interface IngestDoc {
  connectorId?: Id<"connectors">;
  kind: Doc<"source_items">["kind"];
  externalId: string;
  url?: string;
  title: string;
  text: string;
  meta?: Record<string, unknown>;
}

export async function ingestDocument(ctx: Pick<StageContext, "convex" | "embed" | "space">, doc: IngestDoc) {
  const res = await ctx.convex.mutation(api.ingest.upsertItem, {
    spaceId: ctx.space._id,
    connectorId: doc.connectorId,
    kind: doc.kind,
    externalId: doc.externalId,
    url: doc.url,
    title: doc.title.slice(0, 300),
    meta: doc.meta,
    contentHash: contentHash(doc.text),
  });
  if (res.status === "unchanged") return { ...res, chunks: 0 };
  const chunks = chunkText(doc.text);
  let written = 0;
  for (let i = 0; i < chunks.length; i += 16) {
    const batch = chunks.slice(i, i + 16);
    const vectors = await ctx.embed.embed(batch.map((c) => c.text));
    const r = await ctx.convex.mutation(api.ingest.addChunks, {
      sourceItemId: res.sourceItemId,
      version: res.version,
      chunks: batch.map((c, j) => ({ ...c, embedding: vectors[j] })),
    });
    if (r.superseded) break;
    written += r.written;
  }
  return { ...res, chunks: written };
}
