import Google from "@auth/core/providers/google";
import Resend from "@auth/core/providers/resend";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

// Email+password always works (no keys needed locally). Magic link and Google sign-in switch on
// only when their provider keys are set in the Convex deployment env — never a fake button.

const providers = [
  Password,
  ...(process.env.AUTH_RESEND_KEY
    ? [Resend({ apiKey: process.env.AUTH_RESEND_KEY, from: process.env.FROM_EMAIL ?? "Orthogonal <onboarding@resend.dev>" })]
    : []),
  ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? [Google] : []),
];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({ providers });
