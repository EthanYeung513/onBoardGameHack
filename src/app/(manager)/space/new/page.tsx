"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { SplitHero } from "@/components/manager/Logo";
import { ScanStep } from "./ScanStep";

const errorText = (err: unknown, fallback: string) => (err instanceof ConvexError ? (err.data as { message: string }).message : fallback);

// space.html, one page with three steps: welcome → name + company website → live scan.
// The URL carries the space (and scan) once created so a refresh stays on the scan;
// `?rescan=1` (dashboard Settings) skips the form and scans the current space straight away.
function NewSpace() {
  const params = useSearchParams();
  const spaceParam = params.get("space") as Id<"spaces"> | null;
  const scanParam = params.get("scan") as Id<"scans"> | null;
  const rescan = params.get("rescan") === "1";
  const { isAuthenticated } = useConvexAuth();
  const spaces = useQuery(api.spaces.mine, isAuthenticated && rescan && !spaceParam ? {} : "skip");
  const rescanSpace = spaceParam ?? spaces?.[0]?._id ?? null;
  const latest = useQuery(api.scans.latest, spaceParam && !scanParam && !rescan ? { spaceId: spaceParam } : "skip");
  const startScan = useMutation(api.scans.start);
  const viewer = useQuery(api.users.viewer);
  const createSpace = useMutation(api.spaces.create);
  const updateProfile = useMutation(api.users.updateProfile);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [step, setStep] = useState<"welcome" | "info">("welcome");
  const started = useRef(false);
  const [nameInput, setName] = useState<string | null>(null);
  const name = nameInput ?? viewer?.name ?? "";
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showScan = (spaceId: Id<"spaces">, scanId: Id<"scans">) => router.replace(`/space/new?space=${spaceId}&scan=${scanId}`);

  // Re-scan: start a new scan for the current space; no space yet → the form (mockup behaviour).
  useEffect(() => {
    if (!rescan || started.current || !isAuthenticated) return;
    if (!rescanSpace) return;
    started.current = true;
    startScan({ spaceId: rescanSpace })
      .then((scanId) => showScan(rescanSpace, scanId))
      .catch((err) => {
        setError(errorText(err, "Couldn't start the scan. Please try again."));
        setStep("info");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescan, rescanSpace, spaces, isAuthenticated]);

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
      const scanId = await startScan({ spaceId });
      showScan(spaceId, scanId);
    } catch (err) {
      setError(errorText(err, "Couldn't create the space. Please try again."));
      setBusy(false);
    }
  }

  const scanId = scanParam ?? latest?._id ?? null;
  if (spaceParam && scanId) return <ScanStep spaceId={spaceParam} scanId={scanId} />;
  // Waiting for the re-scan to start, or for the space's latest scan to load.
  const noSpaceToRescan = rescan && !spaceParam && spaces?.length === 0;
  const formStep = noSpaceToRescan ? "info" : step;
  if ((rescan && step === "welcome" && !noSpaceToRescan) || (spaceParam && !scanParam && latest === undefined)) return null;

  return (
    <div className="split">
      <SplitHero />
      <div className="right" style={{ position: "relative" }}>
        <button className="btn btn-ghost logout" onClick={() => void signOut().then(() => router.push("/"))}>
          Logout
        </button>
        <div className="card">
          {formStep === "welcome" ? (
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

export default function NewSpacePage() {
  return (
    <Suspense>
      <NewSpace />
    </Suspense>
  );
}
