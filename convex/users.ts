import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/access";

/** The signed-in user, their profile and where to send them (F2 redirect rule). */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const membership = await ctx.db
      .query("space_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      id: userId,
      email: user.email ?? null,
      name: profile?.name ?? user.name ?? null,
      avatarUrl: profile?.avatarUrl ?? user.image ?? null,
      home: membership ? await homeFor(ctx, userId) : "/space/new",
    };
  },
});

export const updateProfile = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const clean = name.trim().slice(0, 80);
    if (existing) await ctx.db.patch(existing._id, { name: clean });
    else await ctx.db.insert("profiles", { userId, name: clean });
  },
});

/** A manager with a scan still running lands back on its live progress, otherwise the dashboard. */
async function homeFor(ctx: QueryCtx, userId: Id<"users">): Promise<string> {
  const members = await ctx.db.query("space_members").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
  for (const m of members) {
    if (m.role === "hire") continue;
    const scan = await ctx.db.query("scans").withIndex("by_space", (q) => q.eq("spaceId", m.spaceId)).order("desc").first();
    if (scan?.status === "running") return `/space/new?space=${m.spaceId}&scan=${scan._id}`;
  }
  return "/dashboard";
}

