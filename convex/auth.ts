import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { allowlistFromEnv, resolveAuthRedirect } from "./lib/authRedirect";

// Email+password always works (no keys needed locally). Magic link and Google sign-in switch on
// only when their provider keys are set in the Convex deployment env — never a fake button.

const providers = [
  Password({
    profile: (params) => ({
      email: String(params.email).trim().toLowerCase(),
      ...(typeof params.name === "string" && params.name.trim() ? { name: params.name.trim().slice(0, 80) } : {}),
    }),
  }),
  ...(process.env.AUTH_RESEND_KEY
    ? [Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.FROM_EMAIL ?? "Orthogonal <onboarding@resend.dev>" })]
    : []),
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google] : []),
];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
  callbacks: {
    // Return OAuth sign-ins to the origin they started on (SITE_URL + SITE_URL_ALLOWLIST; loopback in dev).
    async redirect({ redirectTo }) {
      const site = process.env.SITE_URL;
      if (!site) throw new Error("SITE_URL is not set on this Convex deployment (needed for OAuth sign-in)");
      return resolveAuthRedirect(redirectTo, site, allowlistFromEnv(process.env.SITE_URL_ALLOWLIST));
    },
  },
});
