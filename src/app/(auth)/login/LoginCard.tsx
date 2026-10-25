"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { OrthoMark, TILES } from "./marks";

// login.html (main) made real: same layout, hero video, welcome tiles and Auth0-style overlay
// steps (email → password | sign up), backed by Convex Auth. Google/work-SSO only sign in
// when the deployment has that provider; otherwise the overlay says so instead of faking it.

type Overlay = null | "auth" | "google";
type AuthStep = "a-email" | "a-pass" | "a-signup-form";
const emailOK = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

export function LoginCard({ next }: { next?: string }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const providers = useQuery(api.authInfo.providers);
  const updateProfile = useMutation(api.users.updateProfile);
  const router = useRouter();

  const [overlay, setOverlay] = useState<Overlay>(null);
  const [step, setStep] = useState<AuthStep>("a-email");
  const [sso, setSso] = useState(false);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [semail, setSemail] = useState("");
  const [spass, setSpass] = useState("");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<React.ReactNode>(null);
  const [busy, setBusy] = useState(false);
  const [pendingName, setPendingName] = useState<string | null>(null);

  // Signed in → new users create a space, returning users go to their dashboard (F2).
  useEffect(() => {
    if (!viewer) return;
    const go = () => router.replace(next ?? viewer.home);
    if (pendingName) void updateProfile({ name: pendingName }).finally(go);
    else go();
  }, [viewer, next, router, pendingName, updateProfile]);

  const err = (id: string, text: string) => setErrs((e) => ({ ...e, [id]: text }));
  const open = (ssoMode: boolean) => {
    setSso(ssoMode);
    setStep("a-email");
    setMsg(null);
    setErrs({});
    setOverlay("auth");
  };

  async function onContinue() {
    const em = email.trim().toLowerCase();
    err("email", "");
    setMsg(null);
    if (!emailOK(em)) return err("email", "Please enter a valid email address.");
    if (sso) {
      setMsg(
        <>
          No account found for <b>{em}</b> — check with your IT team that SSO is set up.
        </>,
      );
      return;
    }
    setBusy(true);
    const exists = await convex.query(api.authInfo.hasAccount, { email: em }).finally(() => setBusy(false));
    if (exists) return setStep("a-pass");
    setMsg(
      <>
        No account found for <b>{em}</b>.{" "}
        <a
          style={{ color: "#1d4ed8", fontWeight: 600, cursor: "pointer" }}
          onClick={() => {
            setSemail(em);
            setStep("a-signup-form");
          }}
        >
          Sign up
        </a>
      </>,
    );
  }

  async function onLogin() {
    err("pass", "");
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), password: pass, flow: "signIn" });
    } catch {
      err("pass", "Incorrect password. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onSignup() {
    const nm = name.trim();
    const em = semail.trim().toLowerCase();
    err("signup", "");
    if (!nm) return err("signup", "Please enter your name.");
    if (!emailOK(em)) return err("signup", "Please enter a valid email address.");
    if (spass.length < 8) return err("signup", "Password must be at least 8 characters.");
    setBusy(true);
    try {
      if (await convex.query(api.authInfo.hasAccount, { email: em })) return err("signup", "An account with this email already exists.");
      setPendingName(nm);
      await signIn("password", { email: em, password: spass, name: nm, flow: "signUp" });
    } catch {
      setPendingName(null);
      err("signup", "We couldn't create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function openGoogle() {
    if (providers?.google) void signIn("google", { redirectTo: next ?? "/dashboard" });
    else setOverlay("google");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOverlay(null);
      if (e.key !== "Enter" || overlay !== "auth") return;
      if (step === "a-email") void onContinue();
      else if (step === "a-pass") void onLogin();
      else void onSignup();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const ssoHide = sso ? { display: "none" } : undefined;

  return (
    <div className="lg">
      <div className="page">
        <div className="hero">
          <video autoPlay loop muted playsInline>
            <source src="/assets/web-hero.mp4" type="video/mp4" />
          </video>
          <a className="hero-logo" href="/">
            <OrthoMark size={30} />
            Orthogonal
          </a>
        </div>
        <div className="panel">
          <div className="card">
            <div className="mlogo">
              <span style={{ verticalAlign: "middle", marginRight: 10, display: "inline-flex" }}>
                <OrthoMark size={26} />
              </span>
              Orthogonal
            </div>
            <div id="s-welcome" className="step">
              <div className="head">
                <h1>Welcome to Orthogonal</h1>
                <p className="sub">The AI-powered onboarding platform for your team</p>
              </div>
              <div className="tiles">
                {TILES.map((t) => (
                  <div className="tile" key={t.label}>
                    <svg viewBox="0 0 256 256" fill="currentColor">
                      <path d={t.path} />
                    </svg>
                    <span>{t.label}</span>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" id="b-login" onClick={() => open(false)}>
                Login
              </button>
              <button className="btn btn-dark" id="b-google" onClick={openGoogle}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="gicon" src="/assets/google.svg" alt="" width={26} height={26} />
                Login with Google
              </button>
              <button className="btn btn-dark" id="b-work" onClick={() => open(true)}>
                Login with work account
              </button>
            </div>
          </div>
        </div>
      </div>

      {overlay === "auth" && (
        <div id="ov-auth" className="ov dark" onClick={(e) => e.target === e.currentTarget && setOverlay(null)}>
          <div className="acard">
            <div className="alogo">
              <OrthoMark size={26} />
              Orthogonal
            </div>

            {step === "a-email" && (
              <div id="a-email">
                <h2>Welcome</h2>
                <p className="asub" id="a-sub">
                  {sso ? "Enter your work email to continue to your company sign-in." : "Log in to Orthogonal to continue to Orthogonal Admin."}
                </p>
                <input className="field" id="f-email" type="email" autoComplete="email" placeholder="Email address*" value={email} onChange={(e) => setEmail(e.target.value)} />
                {errs.email && <div className="err" style={{ display: "block" }}>{errs.email}</div>}
                {msg && <div className="msg" style={{ display: "block" }}>{msg}</div>}
                <button className="btn btn-primary" id="b-continue" style={{ marginTop: 16 }} onClick={() => void onContinue()} disabled={busy}>
                  Continue
                </button>
                <div className="divider" style={ssoHide}>OR</div>
                <button className="osbtn" style={ssoHide} id="a-google" onClick={openGoogle}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/assets/google.svg" width={20} height={20} alt="" />
                  Continue with Google
                </button>
                <div className="swap" style={ssoHide}>
                  Don&apos;t have an account? <a id="a-signup" onClick={() => setStep("a-signup-form")}>Sign up</a>
                </div>
              </div>
            )}

            {step === "a-pass" && (
              <div id="a-pass">
                <h2>Welcome back</h2>
                <p className="asub" id="pass-sub">Enter the password for {email.trim().toLowerCase()}</p>
                <input className="field" id="f-pass" type="password" autoComplete="current-password" placeholder="Password*" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
                {errs.pass && <div className="err" style={{ display: "block" }}>{errs.pass}</div>}
                <button className="btn btn-primary" id="b-do-login" style={{ marginTop: 16 }} onClick={() => void onLogin()} disabled={busy}>
                  Continue
                </button>
              </div>
            )}

            {step === "a-signup-form" && (
              <div id="a-signup-form">
                <h2>Sign up</h2>
                <p className="asub">Create your Orthogonal account.</p>
                <input className="field" id="f-name" type="text" autoComplete="name" placeholder="Full name*" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <input className="field" id="f-semail" type="email" autoComplete="email" placeholder="Email address*" value={semail} onChange={(e) => setSemail(e.target.value)} />
                <input className="field" id="f-spass" type="password" autoComplete="new-password" placeholder="Password (8+ characters)*" value={spass} onChange={(e) => setSpass(e.target.value)} />
                {errs.signup && <div className="err" style={{ display: "block" }}>{errs.signup}</div>}
                <button className="btn btn-primary" id="b-do-signup" style={{ marginTop: 16 }} onClick={() => void onSignup()} disabled={busy}>
                  Continue
                </button>
                <div className="swap">
                  Already have an account? <a id="a-back-login" onClick={() => setStep("a-email")}>Log in</a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {overlay === "google" && (
        <div className="ov dark" onClick={(e) => e.target === e.currentTarget && setOverlay(null)}>
          <div className="apcard">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/google.svg" width={34} height={34} alt="" style={{ marginBottom: 14 }} />
            <h2>Google sign-in isn&apos;t set up yet</h2>
            <p>This Orthogonal deployment has no Google OAuth keys. Use your email and password instead.</p>
            <button className="btn btn-primary" onClick={() => open(false)}>
              Log in with email
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
