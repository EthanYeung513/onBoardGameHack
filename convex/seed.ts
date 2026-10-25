import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

// `npm run db:seed` → a demo manager login and the Acme Pay space (content/ has its source docs).
// Idempotent: re-running leaves existing rows alone.

export const DEMO_EMAIL = "demo@orthogonal.dev";
const DEMO_PASSWORD = "demo-password";

export const demo = internalAction({
  args: {},
  handler: async (ctx): Promise<{ email: string; spaceId: string }> => {
    let userId;
    try {
      ({ user: { _id: userId } } = await retrieveAccount(ctx, { provider: "password", account: { id: DEMO_EMAIL } }));
    } catch {
      ({ user: { _id: userId } } = await createAccount(ctx, {
        provider: "password",
        account: { id: DEMO_EMAIL, secret: DEMO_PASSWORD },
        profile: { email: DEMO_EMAIL, name: "Dana Kim" },
      }));
    }
    const spaceId: string = await ctx.runMutation(internal.seed.demoSpace, { userId });
    return { email: DEMO_EMAIL, spaceId };
  },
});

export const demoSpace = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db.query("spaces").withIndex("by_slug", (q) => q.eq("slug", "acme-pay")).first();
    if (existing) return existing._id;
    const spaceId = await ctx.db.insert("spaces", {
      ownerId: userId,
      name: "Acme Pay",
      slug: "acme-pay",
      host: "acmepay.example",
      status: "created",
      autoApproveThreshold: 0.9,
      mode: "offline",
    });
    await ctx.db.insert("space_members", { spaceId, userId, role: "owner" });
    const profile = await ctx.db.query("profiles").withIndex("by_user", (q) => q.eq("userId", userId)).unique();
    if (!profile) await ctx.db.insert("profiles", { userId, name: "Dana Kim" });
    await ctx.db.insert("audit_events", { spaceId, actor: "system:seed", kind: "space.created", payload: { seeded: true } });
    return spaceId;
  },
});
