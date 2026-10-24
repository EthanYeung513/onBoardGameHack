"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { SplitHero } from "@/components/manager/Logo";

type Step = "welcome" | "password" | "magic-sent";

function readable(err: unknown, flow: "signIn" | "signUp"): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/InvalidSecret|InvalidAccountId|Invalid credentials/i.test(msg)) return "That email and password don't match. Try again or sign up.";
  if (/already exists/i.test(msg)) return "An account with that email already exists — log in instead.";
  if (/password/i.test(msg) && flow === "signUp") return "Use a password of at least 8 characters.";
  return "Something went wrong signing you in. Please try again.";
}

export function LoginCard({ next }: { next?: string }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const providers = useQuery(api.authInfo.providers);
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Signed in → new users go to space creation, returning users to their dashboard (F2).
  useEffect(() => {
    if (viewer) router.replace(next ?? viewer.home);
  }, [viewer, next, router]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (flow === "signUp" && password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), password, flow });
    } catch (err) {
      setError(readable(err, flow));
    } finally {
      setBusy(false);
    }
  }

  async function magicLink() {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter your email first, then request a link.");
    setBusy(true);
    try {
      await signIn("resend", { email: email.trim().toLowerCase(), redirectTo: next ?? "/dashboard" });
      setStep("magic-sent");
    } catch {
      setError("We couldn't send a sign-in link. Use your password instead.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <SplitHero />
      <div className="right">
        <div className="card">
          {step === "welcome" && (
            <div className="auth-step">
              <h1>Welcome to Orthogonal</h1>
              <p className="auth-sub">The AI-powered onboarding platform for your team</p>
              <button className="btn btn-primary btn-block btn-big" onClick={() => { setFlow("signIn"); setStep("password"); }}>
                Login
              </button>
              {providers?.google && (
                <button className="btn btn-dark btn-block btn-big auth-gap" onClick={() => void signIn("google", { redirectTo: next ?? "/dashboard" })}>
                  Login with Google
                </button>
              )}
              <p className="auth-swap">
                New to Orthogonal?{" "}
                <a onClick={() => { setFlow("signUp"); setStep("password"); }}>Create an account</a>
              </p>
            </div>
          )}

          {step === "password" && (
            <form className="auth-step" onSubmit={submitPassword} noValidate>
              <button type="button" className="auth-back" onClick={() => { setStep("welcome"); setError(null); }}>
                ← Back
              </button>
              <h1>{flow === "signIn" ? "Welcome back" : "Create your account"}</h1>
              <div className="field">
                <label htmlFor="email">Work email *</label>
                <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </div>
              <div className="field">
                <label htmlFor="password">Password *</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={flow === "signIn" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={flow === "signUp" ? "At least 8 characters" : ""}
                />
              </div>
              {error && <p className="auth-err" role="alert">{error}</p>}
              <button className="btn btn-primary btn-block btn-big" type="submit" disabled={busy}>
                {busy ? "One moment…" : flow === "signIn" ? "Log in" : "Sign up"}
              </button>
              {providers?.magicLink && flow === "signIn" && (
                <button type="button" className="btn btn-ghost btn-block auth-gap" onClick={magicLink} disabled={busy}>
                  Email me a sign-in link instead
                </button>
              )}
              <p className="auth-swap">
                {flow === "signIn" ? "Don't have an account? " : "Already have an account? "}
                <a onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>
                  {flow === "signIn" ? "Sign up" : "Log in"}
                </a>
              </p>
            </form>
          )}

          {step === "magic-sent" && (
            <div className="auth-step">
              <h1>Check your inbox</h1>
              <p className="auth-sub">We sent a sign-in link to {email}.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
