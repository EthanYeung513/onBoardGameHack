import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { factKey } from "../src/lib/brain/normalize";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { factsByKey } from "./lib/brainWrite";
import { fail } from "./lib/errors";
import { factCategory, factStatus } from "./schema";

// Brain review (F16), manager-only: approve / edit / reject extracted facts, add facts by hand, list
// by status. Every write takes the fact's current `version` (409 when someone changed it first),
// emits an audit row, and keeps provenance: citations are never dropped. Rejected facts never
// resurface — extraction checks `dedupeKey` against them (convex/lib/brainWrite.ts).

async function loadFact(ctx: MutationCtx, factId: Id<"facts">, version: number) {
  const fact = await ctx.db.get(factId);
  if (!fact) return fail(404, "Fact not found");
  const { userId } = await requireRole(ctx, fact.spaceId, MANAGERS);
  if (fact.version !== version) return fail(409, "This fact changed since you loaded it. Reload and try again.");
  return { fact, actor: `user:${userId}` };
}

export const list = query({
  args: { spaceId: v.id("spaces"), status: v.optional(factStatus), limit: v.optional(v.number()) },
  handler: async (ctx, { spaceId, status, limit }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const n = Math.min(limit ?? 100, 500);
    const facts = status
      ? await ctx.db.query("facts").withIndex("by_space_status", (q) => q.eq("spaceId", spaceId).eq("status", status)).order("desc").take(n)
      : await ctx.db.query("facts").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").take(n);
    return await Promise.all(
      facts.map(async (f) => {
        const entity = f.entityId ? await ctx.db.get(f.entityId) : null;
        const citations = await Promise.all(
          f.sourceChunkIds.slice(-5).map(async (chunkId) => {
            const chunk = await ctx.db.get(chunkId);
            const item = chunk ? await ctx.db.get(chunk.sourceItemId) : null;
            return { chunkId, snippet: chunk?.text.slice(0, 240) ?? "", title: item?.title ?? "", url: item?.url ?? null, kind: item?.kind ?? null };
          }),
        );
        return {
          id: f._id,
          text: f.text,
          category: f.category,
          confidence: f.confidence,
          status: f.status,
          createdBy: f.createdBy,
          version: f.version,
          entity: entity ? { id: entity._id, name: entity.name, type: entity.type } : null,
          citations,
        };
      }),
    );
  },
});

export const approve = mutation({
  args: { factId: v.id("facts"), version: v.number() },
  handler: async (ctx, { factId, version }) => {
    const { fact, actor } = await loadFact(ctx, factId, version);
    if (fact.status !== "draft" && fact.status !== "stale") return fail(409, `A ${fact.status} fact can't be approved`);
    await ctx.db.patch(factId, { status: "approved", version: version + 1 });
    await audit(ctx, fact.spaceId, actor, "fact.approved", { factId, from: fact.status });
    return { version: version + 1 };
  },
});

/** Rewrites the text (and optionally the category); citations and the dedupe key stay, so the
 * original extraction is recognised as this fact and never comes back as a duplicate draft. */
export const edit = mutation({
  args: { factId: v.id("facts"), version: v.number(), text: v.string(), category: v.optional(factCategory) },
  handler: async (ctx, { factId, version, text, category }) => {
    const { fact, actor } = await loadFact(ctx, factId, version);
    const clean = text.trim();
    if (clean.length < 3 || clean.length > 400) return fail(422, "A fact is 3–400 characters");
    if (fact.status === "rejected") return fail(409, "Rejected facts can't be edited");
    await ctx.db.patch(factId, { text: clean, category: category ?? fact.category, status: "approved", version: version + 1, dedupeKey: fact.dedupeKey ?? factKey(fact.text) });
    await audit(ctx, fact.spaceId, actor, "fact.edited", { factId, before: fact.text, after: clean, category: category ?? fact.category, from: fact.status });
    return { version: version + 1 };
  },
});

export const reject = mutation({
  args: { factId: v.id("facts"), version: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, { factId, version, reason }) => {
    const { fact, actor } = await loadFact(ctx, factId, version);
    if (fact.status === "rejected") return fail(409, "Already rejected");
    await ctx.db.patch(factId, { status: "rejected", version: version + 1, dedupeKey: fact.dedupeKey ?? factKey(fact.text) });
    await audit(ctx, fact.spaceId, actor, "fact.rejected", { factId, text: fact.text, from: fact.status, reason: reason?.slice(0, 300) });
    return { version: version + 1 };
  },
});

/**
 * Manual fact (D-25): cites ≥1 existing chunk of this space, or carries a manager note — the note
 * becomes a `Manager note` source item + chunk, so every fact keeps ≥1 citation.
 */
export const add = mutation({
  args: {
    spaceId: v.id("spaces"),
    text: v.string(),
    category: factCategory,
    entityId: v.optional(v.id("entities")),
    chunkIds: v.optional(v.array(v.id("doc_chunks"))),
    note: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { userId } = await requireRole(ctx, a.spaceId, MANAGERS);
    const text = a.text.trim();
    if (text.length < 3 || text.length > 400) return fail(422, "A fact is 3–400 characters");
    if (a.entityId) {
      const e = await ctx.db.get(a.entityId);
      if (!e || e.spaceId !== a.spaceId) return fail(422, "Unknown entity");
    }
    const chunks: Doc<"doc_chunks">[] = [];
    for (const id of new Set(a.chunkIds ?? [])) {
      const c = await ctx.db.get(id);
      if (!c || c.spaceId !== a.spaceId) return fail(422, "Citations must be chunks of this space");
      chunks.push(c);
    }
    const note = a.note?.trim();
    if (!chunks.length && !note) return fail(422, "Cite at least one source, or add a note saying where this comes from");
    const key = factKey(text);
    if ((await factsByKey(ctx, a.spaceId, key)).some((f) => f.status !== "rejected" && f.entityId === a.entityId)) {
      return fail(409, "This fact is already in the brain");
    }
    if (note) {
      const now = Date.now();
      const sourceItemId = await ctx.db.insert("source_items", {
        spaceId: a.spaceId,
        kind: "doc",
        externalId: `manual-note:${userId}:${now}`,
        title: "Manager note",
        meta: { manual: true, by: userId },
        contentHash: key,
        version: 1,
        fetchedAt: now,
      });
      const chunkId = await ctx.db.insert("doc_chunks", { spaceId: a.spaceId, sourceItemId, version: 1, idx: 0, text: note.slice(0, 2000), tokens: Math.ceil(note.length / 4), extractedAt: now });
      chunks.push((await ctx.db.get(chunkId))!);
    }
    const factId = await ctx.db.insert("facts", {
      spaceId: a.spaceId,
      entityId: a.entityId,
      category: a.category,
      text,
      confidence: 1,
      sourceChunkIds: chunks.map((c) => c._id),
      status: "approved",
      createdBy: "manager",
      version: 1,
      dedupeKey: key,
    });
    for (const c of chunks) await ctx.db.insert("fact_citations", { spaceId: a.spaceId, factId, chunkId: c._id, sourceItemId: c.sourceItemId });
    await audit(ctx, a.spaceId, `user:${userId}`, "fact.added", { factId, text, category: a.category, chunkIds: chunks.map((c) => c._id), note: Boolean(note) });
    return { factId };
  },
});
