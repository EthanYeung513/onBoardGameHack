"use client";
import { useActionState, useState } from "react";
import { sendMagicLink, signInWithPassword, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [pwState, pwAction, pwPending] = useActionState<LoginState, FormData>(signInWithPassword, {});
  const [linkState, linkAction, linkPending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  const state = mode === "password" ? pwState : linkState;

  return (
    <form action={mode === "password" ? pwAction : linkAction} className="space-y-4" aria-describedby="login-status">
      <input type="hidden" name="next" value={next} />
      <label className="block space-y-1">
        <span className="text-sm font-medium">Email</span>
        <input className="g-input" type="email" name="email" autoComplete="email" required data-testid="login-email" />
      </label>
      {mode === "password" && (
        <label className="block space-y-1">
          <span className="text-sm font-medium">Password</span>
          <input className="g-input" type="password" name="password" autoComplete="current-password" required data-testid="login-password" />
        </label>
      )}
      <div id="login-status" role="status" className="min-h-6 text-sm">
        {state.error && <p style={{ color: "var(--g-danger)" }}>{state.error}</p>}
        {linkState.sent && mode === "link" && <p style={{ color: "var(--g-ok)" }}>Check {linkState.sent} for a sign-in link.</p>}
      </div>
      <button className="g-btn w-full justify-center" type="submit" disabled={pwPending || linkPending} data-testid="login-submit">
        {mode === "password" ? (pwPending ? "Signing in" : "Sign in") : linkPending ? "Sending link" : "Email me a sign-in link"}
      </button>
      <button type="button" className="g-muted text-sm underline underline-offset-4" onClick={() => setMode(mode === "password" ? "link" : "password")}>
        {mode === "password" ? "Use an email link instead" : "Use a password instead"}
      </button>
    </form>
  );
}
