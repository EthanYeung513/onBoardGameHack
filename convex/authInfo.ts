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
