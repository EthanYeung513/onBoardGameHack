import { v } from "convex/values";
import { query } from "./_generated/server";

/** Which sign-in methods this deployment has keys for, so the login page never shows a dead button. */
export const providers = query({
  args: {},
  handler: async () => ({
    password: true,
    magicLink: Boolean(process.env.AUTH_RESEND_KEY),
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  }),
});

/** The mockup's email-first login: Continue → password if the account exists, else "Sign up". */
export const hasAccount = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) => q.eq("provider", "password").eq("providerAccountId", email.trim().toLowerCase()))
      .first();
    return account !== null;
  },
});
