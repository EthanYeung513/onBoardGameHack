import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { fail } from "./lib/errors";
import { workerMutation } from "./lib/worker";
import { connectorType, sourceKind } from "./schema";

// The one write path for every source — website pages, files, GitHub, Slack… (BUILD-CONTRACT
// "Connector contract" + "Drift and self-adaptation contract", F34–F36). Every item is compared
// with its stored version: new → `added`, different hash → `changed`, missing from a full sync →
// `removed`. `changed`/`removed` immediately mark every fact citing the item `stale` and flag
// courses teaching those facts `needsRefresh`; extraction then picks up the new chunks.

/** How a source reads in audit rows: "slack · #payments" — connector type, kind and title. */
export async function describeSource(ctx: MutationCtx, item: Doc<"source_items">) {
  const connector = item.connectorId ? await ctx.db.get(item.connectorId) : null;
  return { sourceItemId: item._id, connectorType: connector?.type ?? "manual", kind: item.kind, title: item.title, url: item.url };
}

/**
 * F35/F36 cascade for one source item, step-level: every fact citing the item goes `stale`, and every
 * course teaching one of those facts gets `needsRefresh` plus the teaching step ids in `staleStepIds`.
 * Audit rows read source → fact → course → step. Returns how many facts went stale.
 */
export async function markItemStale(ctx: MutationCtx, sourceItemId: Id<"source_items">, reason: "changed" | "removed") {
  const item = await ctx.db.get(sourceItemId);
  if (!item) return 0;
  const source = await describeSource(ctx, item);
  const citations = await ctx.db.query("fact_citations").withIndex("by_source", (q) => q.eq("sourceItemId", sourceItemId)).collect();
  const factIds = [...new Set(citations.map((c) => c.factId))];
  const courses = new Map<Id<"courses">, { fact: Doc<"facts">; stepId?: string }[]>();
  let stale = 0;
  for (const factId of factIds) {
    const fact = await ctx.db.get(factId);
    if (!fact || fact.status === "stale" || fact.status === "rejected") continue;
    await ctx.db.patch(factId, { status: "stale", version: fact.version + 1 });
    await ctx.db.insert("audit_events", {
      spaceId: item.spaceId,
      actor: "system:cascade",
      kind: "fact.stale",
      payload: { factId, factText: fact.text, sourceItemId, source, reason, previousStatus: fact.status },
    });
    stale++;
    for (const cf of await ctx.db.query("course_facts").withIndex("by_fact", (q) => q.eq("factId", factId)).collect()) {
      const list = courses.get(cf.courseId) ?? [];
      list.push({ fact, stepId: cf.stepId });
      courses.set(cf.courseId, list);
    }
  }
  for (const [courseId, taught] of courses) {
    const course = await ctx.db.get(courseId);
    if (!course) continue;
    const before = new Set(course.staleStepIds ?? []);
    const steps = new Set(before);
    for (const t of taught) if (t.stepId) steps.add(t.stepId);
    const addedSteps = [...steps].filter((s) => !before.has(s));
    if (course.needsRefresh && addedSteps.length === 0) continue;
    await ctx.db.patch(courseId, { needsRefresh: true, ...(steps.size ? { staleStepIds: [...steps] } : {}) });
    if (!course.needsRefresh) {
      await ctx.db.insert("audit_events", { spaceId: item.spaceId, actor: "system:cascade", kind: "course.needs_refresh", payload: { courseId, courseTitle: course.title, sourceItemId, source } });
    }
    for (const t of taught) {
      if (!t.stepId || !addedSteps.includes(t.stepId)) continue;
      await ctx.db.insert("audit_events", {
        spaceId: item.spaceId,
        actor: "system:cascade",
        kind: "course.step_stale",
        payload: {
          chain: `${source.connectorType} “${source.title}” → fact “${t.fact.text.slice(0, 80)}” → course “${course.title}” → step ${t.stepId}`,
          source,
          factId: t.fact._id,
          factText: t.fact.text,
          courseId,
          courseTitle: course.title,
          stepId: t.stepId,
          reason,
        },
      });
    }
  }
  return stale;
}

/** Drop embeddings of superseded chunks so search only sees the current version; text stays for provenance. */
async function retireChunks(ctx: MutationCtx, sourceItemId: Id<"source_items">, keepVersion: number) {
  const chunks = await ctx.db.query("doc_chunks").withIndex("by_source", (q) => q.eq("sourceItemId", sourceItemId)).collect();
  for (const c of chunks) if (c.version !== keepVersion && c.embedding) await ctx.db.patch(c._id, { embedding: undefined });
}

export const ensureConnector = workerMutation({
  args: { spaceId: v.id("spaces"), type: connectorType },
  handler: async (ctx, { spaceId, type }) => {
    const existing = await ctx.db.query("connectors").withIndex("by_space_type", (q) => q.eq("spaceId", spaceId).eq("type", type)).first();
    if (existing) return existing._id;
    return await ctx.db.insert("connectors", { spaceId, type, status: "syncing" });
  },
});

export const upsertItem = workerMutation({
  args: {
    spaceId: v.id("spaces"),
    connectorId: v.optional(v.id("connectors")),
    kind: sourceKind,
    externalId: v.string(),
    url: v.optional(v.string()),
    title: v.string(),
    meta: v.optional(v.any()),
    contentHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("source_items")
      .withIndex("by_space_external", (q) => q.eq("spaceId", args.spaceId).eq("externalId", args.externalId))
      .first();

    if (!existing) {
      const id = await ctx.db.insert("source_items", { ...args, version: 1, fetchedAt: now });
      await ctx.db.insert("diff_events", { spaceId: args.spaceId, kind: "added", sourceItemId: id, summary: `New ${args.kind}: ${args.title}` });
      return { sourceItemId: id, version: 1, status: "added" as const };
    }
    if (existing.contentHash === args.contentHash && !existing.removedAt) {
      await ctx.db.patch(existing._id, { fetchedAt: now, title: args.title, url: args.url, meta: args.meta });
      return { sourceItemId: existing._id, version: existing.version, status: "unchanged" as const };
    }
    const version = existing.version + 1;
    await ctx.db.patch(existing._id, { ...args, version, fetchedAt: now, removedAt: undefined });
    await ctx.db.insert("diff_events", { spaceId: args.spaceId, kind: "changed", sourceItemId: existing._id, summary: `Changed ${args.kind}: ${args.title}` });
    await retireChunks(ctx, existing._id, version);
    const stale = await markItemStale(ctx, existing._id, "changed");
    return { sourceItemId: existing._id, version, status: "changed" as const, staleFacts: stale };
  },
});

/** Idempotent by (item, version, idx): a resumed slice re-sending a batch writes nothing twice. */
export const addChunks = workerMutation({
  args: {
    sourceItemId: v.id("source_items"),
    version: v.number(),
    chunks: v.array(v.object({ idx: v.number(), text: v.string(), tokens: v.number(), embedding: v.optional(v.array(v.float64())) })),
  },
  handler: async (ctx, { sourceItemId, version, chunks }) => {
    const item = await ctx.db.get(sourceItemId);
    if (!item) return fail(404, "Source item not found");
    if (item.version !== version) return { written: 0, superseded: true };
    let written = 0;
    for (const c of chunks) {
      const dup = await ctx.db
        .query("doc_chunks")
        .withIndex("by_source_version", (q) => q.eq("sourceItemId", sourceItemId).eq("version", version).eq("idx", c.idx))
        .first();
      if (dup) continue;
      await ctx.db.insert("doc_chunks", { spaceId: item.spaceId, sourceItemId, version, ...c });
      written++;
    }
    return { written, superseded: false };
  },
});

/** After a full sync: items this connector didn't touch since `before` were removed upstream. */
export const sweepRemoved = workerMutation({
  args: { spaceId: v.id("spaces"), connectorId: v.id("connectors"), before: v.number() },
  handler: async (ctx, { spaceId, connectorId, before }) => {
    const items = await ctx.db.query("source_items").withIndex("by_connector", (q) => q.eq("connectorId", connectorId)).collect();
    let removed = 0;
    for (const item of items) {
      if (item.removedAt || item.fetchedAt >= before || item.spaceId !== spaceId) continue;
      await ctx.db.patch(item._id, { removedAt: Date.now() });
      await ctx.db.insert("diff_events", { spaceId, kind: "removed", sourceItemId: item._id, summary: `Removed ${item.kind}: ${item.title}` });
      await retireChunks(ctx, item._id, -1);
      await markItemStale(ctx, item._id, "removed");
      removed++;
    }
    return { removed };
  },
});
