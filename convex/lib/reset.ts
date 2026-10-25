import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Settings → "Reset space" (F29): deletes a space's content in bounded batches. The space row,
// its members and its audit trail are kept. Child rows without a `by_space` index are removed
// through their parent (course_facts, fact_citations, entity_mentions, connector_credentials).

export const RESET_BATCH = 400;

type Row = { _id: Id<TableNames> } & Record<string, unknown>;
type Step = {
  rows: (n: number) => Promise<Row[]>;
  /** Deletes up to `n` children of `row`; returns how many it deleted (== n means "maybe more"). */
  children?: (row: Row, n: number) => Promise<number>;
};

async function dropAll(ctx: MutationCtx, rows: { _id: Id<TableNames> }[]) {
  for (const r of rows) await ctx.db.delete(r._id);
  return rows.length;
}

async function dropStorage(ctx: MutationCtx, ...refs: unknown[]) {
  for (const ref of refs) if (ref) await ctx.storage.delete(ref as Id<"_storage">).catch(() => undefined);
}

function steps(ctx: MutationCtx, spaceId: Id<"spaces">): Step[] {
  const bySpace = <T extends Row>(q: () => { take: (n: number) => Promise<unknown[]> }) => (n: number) => q().take(n) as Promise<T[]>;
  return [
    { rows: bySpace(() => ctx.db.query("attempts").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("redemptions").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("rewards").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("hire_invites").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("hires").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    {
      rows: bySpace(() => ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      children: async (row, n) =>
        dropAll(ctx, await ctx.db.query("course_facts").withIndex("by_course", (q) => q.eq("courseId", row._id as Id<"courses">)).take(n)),
    },
    {
      rows: bySpace(() => ctx.db.query("facts").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      children: async (row, n) =>
        dropAll(ctx, await ctx.db.query("fact_citations").withIndex("by_fact", (q) => q.eq("factId", row._id as Id<"facts">)).take(n)),
    },
    { rows: bySpace(() => ctx.db.query("edges").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    {
      rows: bySpace(() => ctx.db.query("entities").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      children: async (row, n) =>
        dropAll(ctx, await ctx.db.query("entity_mentions").withIndex("by_entity", (q) => q.eq("entityId", row._id as Id<"entities">)).take(n)),
    },
    { rows: bySpace(() => ctx.db.query("diff_events").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    {
      rows: bySpace(() => ctx.db.query("doc_chunks").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      // Mentions/citations of chunks left over from merged entities or orphaned facts.
      children: async (row, n) => {
        const chunkId = row._id as Id<"doc_chunks">;
        const m = await dropAll(ctx, await ctx.db.query("entity_mentions").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).take(n));
        return m + (await dropAll(ctx, await ctx.db.query("fact_citations").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).take(n - m)));
      },
    },
    {
      rows: bySpace(() => ctx.db.query("source_items").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      children: async (row) => (await dropStorage(ctx, (row as unknown as Doc<"source_items">).rawRef), 0),
    },
    {
      rows: bySpace(() => ctx.db.query("connectors").withIndex("by_space", (q) => q.eq("spaceId", spaceId))),
      children: async (row, n) => {
        const ref = (row as unknown as Doc<"connectors">).authRef;
        return ref ? dropAll(ctx, await ctx.db.query("connector_credentials").withIndex("by_ref", (q) => q.eq("ref", ref)).take(n)) : 0;
      },
    },
    { rows: bySpace(() => ctx.db.query("job_events").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("jobs").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    {
      rows: bySpace(() => ctx.db.query("crawl_pages").withIndex("by_space_url", (q) => q.eq("spaceId", spaceId))),
      children: async (row) => {
        const page = row as unknown as Doc<"crawl_pages">;
        await dropStorage(ctx, page.artifactRef, page.screenshotRef);
        return 0;
      },
    },
    { rows: bySpace(() => ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
    { rows: bySpace(() => ctx.db.query("brand_profiles").withIndex("by_space", (q) => q.eq("spaceId", spaceId))) },
  ];
}

/** Deletes up to `budget` rows. Returns `{ done, deleted }`; reschedule while `done` is false. */
export async function resetBatch(ctx: MutationCtx, spaceId: Id<"spaces">, budget = RESET_BATCH) {
  let left = budget;
  for (const step of steps(ctx, spaceId)) {
    while (left > 0) {
      const rows = await step.rows(Math.min(left, 100));
      if (!rows.length) break;
      for (const row of rows) {
        if (left <= 0) break;
        if (step.children) {
          const n = await step.children(row, left);
          left -= n;
          if (left <= 0) break; // children may remain; the parent goes in the next batch
        }
        await ctx.db.delete(row._id);
        left--;
      }
    }
    if (left <= 0) return { done: false, deleted: budget };
  }
  return { done: true, deleted: budget - left };
}
