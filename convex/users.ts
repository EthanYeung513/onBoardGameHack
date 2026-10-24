import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
      home: membership ? "/dashboard" : "/space/new",
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
