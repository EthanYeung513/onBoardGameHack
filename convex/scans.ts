import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { startScanJobs } from "./pipeline";

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
    await startScanJobs(ctx, spaceId, scanId);
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

/** The signed-in manager's newest running scan (any of their spaces) — re-attach after a reload. */
export const inFlight = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const members = await ctx.db.query("space_members").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    let best: { spaceId: Id<"spaces">; scanId: Id<"scans">; at: number } | null = null;
    for (const m of members) {
      if (m.role === "hire") continue;
      const scan = await ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", m.spaceId)).order("desc").first();
      if (scan?.status === "running" && (!best || scan._creationTime > best.at)) best = { spaceId: m.spaceId, scanId: scan._id, at: scan._creationTime };
    }
    return best ? { spaceId: best.spaceId, scanId: best.scanId } : null;
  },
});

/** Dashboard banner: a scan in progress, or a finished scan whose brand the manager hasn't reviewed yet. */
export const nextStep = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space } = await requireRole(ctx, spaceId, MANAGERS);
    const scan = await ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").first();
    if (scan?.status === "running") return { kind: "scanning" as const, scanId: scan._id };
    if (scan?.status === "succeeded" && space.brandProfileId) {
      const decided = await ctx.db.query("brand_decisions").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).first();
      if (!decided) return { kind: "pickDesign" as const, scanId: scan._id };
    }
    return null;
  },
});
