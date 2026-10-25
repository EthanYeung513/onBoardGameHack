import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";
import { displayName } from "./lib/progress";

// F28 Rewards tab: the space's shop catalog (manager CRUD) and its redemptions. Removing a reward
// deactivates it so past redemptions keep their name.

function validate(name: string | undefined, costCoins: number | undefined) {
  if (name !== undefined && (!name.trim() || name.trim().length > 80)) fail(422, "Reward name must be 1–80 characters");
  if (costCoins !== undefined && (!Number.isInteger(costCoins) || costCoins < 1 || costCoins > 100_000))
    fail(422, "Cost must be a whole number of coins between 1 and 100000");
}

async function ownReward(ctx: MutationCtx, rewardId: Id<"rewards">) {
  const reward = await ctx.db.get(rewardId);
  if (!reward) return fail(404, "Reward not found");
  const { userId } = await requireRole(ctx, reward.spaceId, MANAGERS);
  return { reward, userId };
}

export const list = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    await requireRole(ctx, spaceId, MANAGERS);
    const rewards = await ctx.db.query("rewards").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(200);
    const recent = await ctx.db.query("redemptions").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).order("desc").take(50);
    const byId = new Map(rewards.map((r) => [r._id, r]));
    const redemptions = await Promise.all(
      recent.map(async (r) => {
        const hire = await ctx.db.get(r.hireId);
        return {
          _id: r._id,
          at: r._creationTime,
          status: r.status,
          hireName: hire ? displayName(hire) : "A former hire",
          rewardName: byId.get(r.rewardId)?.name ?? "a removed reward",
        };
      }),
    );
    return {
      rewards: rewards.filter((r) => r.active).map((r) => ({ _id: r._id, name: r.name, costCoins: r.costCoins })),
      redemptions,
    };
  },
});

export const create = mutation({
  args: { spaceId: v.id("spaces"), name: v.string(), costCoins: v.number() },
  handler: async (ctx, { spaceId, name, costCoins }) => {
    const { userId } = await requireRole(ctx, spaceId, MANAGERS);
    validate(name, costCoins);
    const rewardId = await ctx.db.insert("rewards", { spaceId, name: name.trim(), costCoins, active: true });
    await audit(ctx, spaceId, `user:${userId}`, "reward.created", { rewardId, name: name.trim(), costCoins });
    return rewardId;
  },
});

export const update = mutation({
  args: { rewardId: v.id("rewards"), name: v.optional(v.string()), costCoins: v.optional(v.number()) },
  handler: async (ctx, { rewardId, name, costCoins }) => {
    const { reward, userId } = await ownReward(ctx, rewardId);
    validate(name, costCoins);
    const patch = { ...(name !== undefined ? { name: name.trim() } : {}), ...(costCoins !== undefined ? { costCoins } : {}) };
    await ctx.db.patch(rewardId, patch);
    await audit(ctx, reward.spaceId, `user:${userId}`, "reward.updated", { rewardId, ...patch });
  },
});

export const remove = mutation({
  args: { rewardId: v.id("rewards") },
  handler: async (ctx, { rewardId }) => {
    const { reward, userId } = await ownReward(ctx, rewardId);
    await ctx.db.patch(rewardId, { active: false });
    await audit(ctx, reward.spaceId, `user:${userId}`, "reward.removed", { rewardId });
  },
});

/** "Send to a hire": the manager gifts a reward to a hire in this space (no coins spent). */
export const send = mutation({
  args: { rewardId: v.id("rewards"), email: v.string() },
  handler: async (ctx, { rewardId, email }) => {
    const { reward, userId } = await ownReward(ctx, rewardId);
    if (!reward.active) fail(404, "Reward not found");
    const hire = await ctx.db
      .query("hires")
      .withIndex("by_space_email", (q) => q.eq("spaceId", reward.spaceId).eq("email", email.trim().toLowerCase()))
      .unique();
    if (!hire) return fail(404, "No hire with that email in this space. Invite them first.");
    const redemptionId = await ctx.db.insert("redemptions", { spaceId: reward.spaceId, rewardId, hireId: hire._id, status: "fulfilled" });
    await audit(ctx, reward.spaceId, `user:${userId}`, "reward.sent", { rewardId, hireId: hire._id, redemptionId });
    return redemptionId;
  },
});
