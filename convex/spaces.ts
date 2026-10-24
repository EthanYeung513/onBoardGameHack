import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { audit, MANAGERS, requireRole, requireUser } from "./lib/access";
import { fail } from "./lib/errors";
import { normalizeHost, slugify } from "./lib/slug";

const DEFAULT_AUTO_APPROVE = 0.9;

/** Create-space flow (F3): the caller becomes owner. The scan is kicked off by `scans.start`. */
export const create = mutation({
  args: { name: v.string(), website: v.string() },
  handler: async (ctx, { name, website }) => {
    const userId = await requireUser(ctx);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) fail(422, "Company name must be 1–80 characters");
    let host: string;
    try {
      host = normalizeHost(website);
    } catch {
      return fail(422, "Enter a website like acme.com");
    }

    const base = slugify(trimmed);
    let slug = base;
    for (let n = 2; await ctx.db.query("spaces").withIndex("by_slug", (q) => q.eq("slug", slug)).first(); n++) {
      slug = `${base}-${n}`;
    }

    const spaceId = await ctx.db.insert("spaces", {
      ownerId: userId,
      name: trimmed,
      slug,
      host,
      status: "created",
      autoApproveThreshold: DEFAULT_AUTO_APPROVE,
    });
    await ctx.db.insert("space_members", { spaceId, userId, role: "owner" });
    await audit(ctx, spaceId, `user:${userId}`, "space.created", { name: trimmed, host, slug });
    return { spaceId, slug };
  },
});

/** Spaces the caller belongs to, newest first, with their role. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const memberships = await ctx.db
      .query("space_members")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const space = await ctx.db.get(m.spaceId);
        return space ? { ...space, role: m.role } : null;
      }),
    );
    return rows.filter((r) => r !== null).sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const get = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const { space, member } = await requireRole(ctx, spaceId, ["owner", "manager", "hire"]);
    const brand = space.brandProfileId ? await ctx.db.get(space.brandProfileId) : null;
    return { ...space, role: member.role, brand };
  },
});

export const update = mutation({
  args: {
    spaceId: v.id("spaces"),
    name: v.optional(v.string()),
    autoApproveThreshold: v.optional(v.number()),
  },
  handler: async (ctx, { spaceId, name, autoApproveThreshold }) => {
    const { userId } = await requireRole(ctx, spaceId, MANAGERS);
    const patch: { name?: string; autoApproveThreshold?: number } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 80) fail(422, "Company name must be 1–80 characters");
      patch.name = trimmed;
    }
    if (autoApproveThreshold !== undefined) {
      if (autoApproveThreshold < 0 || autoApproveThreshold > 1) fail(422, "Threshold must be between 0 and 1");
      patch.autoApproveThreshold = autoApproveThreshold;
    }
    await ctx.db.patch(spaceId, patch);
    await audit(ctx, spaceId, `user:${userId}`, "space.updated", patch);
  },
});
