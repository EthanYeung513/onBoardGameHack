import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { audit, MANAGERS, requireRole } from "./lib/access";
import { fail } from "./lib/errors";

// F26 invite flow: a manager invites a hire by email → `hires` row (invited) + a `hire_invites`
// token. The play link is `/join/<slug>?invite=<token>` (the public hire route); sending it by email lands with Resend (S14).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const invite = mutation({
  args: { spaceId: v.id("spaces"), email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { spaceId, email, name }) => {
    const { userId, space } = await requireRole(ctx, spaceId, MANAGERS);
    const clean = email.trim().toLowerCase();
    if (!EMAIL.test(clean) || clean.length > 200) fail(422, "Enter a work email like sam@acme.com");

    const existing = await ctx.db
      .query("hires")
      .withIndex("by_space_email", (q) => q.eq("spaceId", spaceId).eq("email", clean))
      .unique();
    const hireId =
      existing?._id ?? (await ctx.db.insert("hires", { spaceId, email: clean, name: name?.trim() || undefined, status: "invited", coins: 0 }));

    // Re-inviting the same email reuses its open token so earlier links keep working.
    const invites = await ctx.db.query("hire_invites").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(1000);
    const open = invites.find((i) => i.email === clean && !i.acceptedAt);
    const token = open?.token ?? newToken();
    if (!open) await ctx.db.insert("hire_invites", { spaceId, email: clean, token });

    await audit(ctx, spaceId, `user:${userId}`, "hire.invited", { hireId, email: clean, reused: Boolean(open) });
    return { hireId, token, path: `/join/${space.slug}?invite=${token}`, emailSent: false };
  },
});
