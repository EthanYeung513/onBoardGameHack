import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { enqueue } from "./pipeline";

/** Start a website scan for the space (space.html "Scan my company →", Settings re-scan F8). */
export const start = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const running = await ctx.db
      .query("scans")
      .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return running._id;
    const scanId = await ctx.db.insert("scans", { spaceId, url: `https://${space.host}`, status: "running", progress: 0, pageCount: 0 });
    await ctx.db.patch(spaceId, { status: "scanning" });
    await enqueue(ctx, { spaceId, scanId }, "crawl", {});
    await audit(ctx, spaceId, `user:${userId}`, "scan.started", { scanId, url: `https://${space.host}` });
    return scanId;
  },
});

/** The space's newest scan, for the scan screen and Settings. */
export const latest = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    return await ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").first();
  },
});

export const get = query({
  args: { scanId: v.id("scans") },
  handler: async (ctx, { scanId }) => {
    const scan = await ctx.db.get(scanId);
    if (!scan) return fail(404, "Scan not found");
    await requireRole(ctx, scan.spaceId, MANAGERS);
    return scan;
  },
});
