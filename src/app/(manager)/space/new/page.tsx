"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { SplitHero } from "@/components/manager/Logo";

// space.html steps 1–2: welcome → name + company website → create the space and start its scan.
export default function NewSpacePage() {
  const viewer = useQuery(api.users.viewer);
  const createSpace = useMutation(api.spaces.create);
  const updateProfile = useMutation(api.users.updateProfile);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [step, setStep] = useState<"welcome" | "info">("welcome");
  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? viewer?.name ?? "";
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !site.trim()) return setError("Please enter your name and a website.");
    setBusy(true);
    try {
      await updateProfile({ name });
      // space.html asks only for the manager's name and the website; the company name starts as the
      // site's name and is refined by the scan/Settings.
      const host = site.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
      const companyName = host.split(/[./]/)[0].replace(/^./, (c) => c.toUpperCase());
      const { spaceId } = await createSpace({ name: companyName, website: site });
      // S5 replaces this with the live scan screen (`/space/:id/scan`).
      router.push(`/dashboard?space=${spaceId}`);
    } catch (err) {
      setError(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't create the space. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="split">
      <SplitHero />
      <div className="right" style={{ position: "relative" }}>
        <button className="btn btn-ghost logout" onClick={() => void signOut().then(() => router.push("/"))}>
          Logout
        </button>
        <div className="card">
          {step === "welcome" ? (
            <div>
              <h1>
                Welcome to
                <br />
                Orthogonal
              </h1>
              <div className="hintbox">
                <p>Create your first Space to get started.</p>
                <button className="btn btn-primary btn-block" onClick={() => setStep("info")}>
                  Create a Space
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <h1>
                Create Orthogonal
                <br />
                Space
              </h1>
              <div className="field">
                <label htmlFor="mgr-name">Your name *</label>
                <input id="mgr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dana Kim" />
              </div>
              <div className="field">
                <label htmlFor="mgr-site">Company website *</label>
                <input id="mgr-site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. mubit.ai" />
              </div>
              {error && <div className="form-err" role="alert" style={{ display: "block" }}>{error}</div>}
              <button className="btn btn-primary btn-block btn-big" type="submit" disabled={busy}>
                Scan my company →
              </button>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
                Our agents will read your public site to learn your brand and seed your company brain.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
