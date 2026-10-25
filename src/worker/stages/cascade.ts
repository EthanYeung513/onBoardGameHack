import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { extractChunk } from "../brain/extract";
import type { StageDefinition } from "../types";

// F34/F35 drift cascade, per space: walks unprocessed `diff_events` oldest first. `added`/`changed`
// → the item's current chunks are extracted (re-running resolution; a stale fact re-found in the new
// version is restored by the dedupe), then `brainWorker.settleDiff` restores facts whose cited
// passage is unchanged and leaves the rest `stale` for review. `removed` → nothing to extract.
// Website pages and connector items (Slack, Jira, GitHub, Notion, Drive, files) are handled alike.
// Resumable: `processedAt` marks finished events; the cursor keeps the last processed id + totals.

const RESERVE_MS = 12_000;

interface Cursor {
  lastId?: Id<"diff_events">;
  processed?: number;
  refreshed?: number;
  restored?: number;
  stillStale?: number;
}

export const cascadeStage: StageDefinition = {
  name: "cascade",
  async run(ctx) {
    const c = { processed: 0, refreshed: 0, restored: 0, stillStale: 0, ...(ctx.job.cursor as Cursor) };
    const spaceId = ctx.space._id;
    const rejected = await ctx.convex.query(api.brainWorker.rejectedExamples, { spaceId });
    const pause = () => ({ done: false as const, cursor: { ...c }, progress: 0.5 });
    for (;;) {
      const events = await ctx.convex.query(api.brainWorker.nextDiffEvents, { spaceId, limit: 20 });
      if (!events.length) break;
      for (const ev of events) {
        let refreshed = 0;
        if (ev.kind !== "removed" && !ev.removed) {
          for (;;) {
            const chunks = await ctx.convex.query(api.brainWorker.pendingChunks, { spaceId, sourceItemId: ev.sourceItemId, limit: 8 });
            if (!chunks.length) break;
            for (const chunk of chunks) {
              if (ctx.remainingMs() < RESERVE_MS || ctx.lost()) return pause();
              const r = await extractChunk(ctx, chunk, rejected, "agent:cascade");
              if (!r.skipped) refreshed += r.facts.refreshed;
            }
          }
        }
        if (ctx.remainingMs() < RESERVE_MS / 2 || ctx.lost()) return pause();
        const s = await ctx.convex.mutation(api.brainWorker.settleDiff, { diffEventId: ev.id, refreshed });
        Object.assign(c, {
          lastId: ev.id,
          processed: c.processed + 1,
          refreshed: c.refreshed + refreshed,
          restored: c.restored + s.restored,
          stillStale: c.stillStale + s.stillStale,
        });
        await ctx.progress(0.5, { ...c });
        if (ev.kind !== "added" || refreshed || s.restored || s.stillStale) {
          await ctx.event("info", `${ev.connectorType} · ${ev.summary}: ${refreshed + s.restored} facts refreshed, ${s.stillStale} need review`, { diffEventId: ev.id });
        }
      }
    }
    // D-36: rewrite the affected course steps now (marked "New"); the manager decides when the
    // hire's world gets them ("Update courses").
    const { queued } = await ctx.convex.mutation(api.courses.refreshAfterDrift, { spaceId });
    if (queued) await ctx.event("info", `${queued} course${queued === 1 ? "" : "s"} taught facts that changed: refreshing those steps for your review`);
    return { done: true, summary: `${c.processed} changes applied: ${c.refreshed + c.restored} facts refreshed, ${c.stillStale} still stale for review` };
  },
};
