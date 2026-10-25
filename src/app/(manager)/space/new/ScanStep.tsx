"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { brandVars } from "@/components/manager/brand";
import { scanView } from "@/components/manager/scanSteps";
import "./scan.css";

const SKELETON = ["60%", "90%", "75%", "40%", "80%", "55%"];

// space.html step 3 ("Reading your website."), driven by the live scan instead of the mockup's timer.
export function ScanStep({ spaceId, scanId }: { spaceId: Id<"spaces">; scanId: Id<"scans"> }) {
  const status = useQuery(api.pipeline.scanStatus, { scanId });
  const space = useQuery(api.spaces.get, { spaceId });
  const resume = useMutation(api.pipeline.resume);
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [opacity, setOpacity] = useState(1);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const host = space?.host ?? status?.scan.url.replace(/^https?:\/\//, "") ?? "";
  const view = status ? scanView(status, host, now) : null;
  const phase = view?.phase;
  const live = phase === "running" || phase === "retrying" || phase === "waiting";

  // Clock for the "waiting for a worker" check; the mockup's page flicker while the scan reads.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!live) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      setOpacity(0.4 + 0.6 * Math.random());
      t = setTimeout(tick, 900 + Math.random() * 700);
    };
    t = setTimeout(tick, 0);
    return () => clearTimeout(t);
  }, [live]);

  // Mockup: bar fills, then `location.href = 'editor.html'` 900 ms later.
  useEffect(() => {
    if (phase !== "succeeded") return;
    const t = setTimeout(() => router.push(`/editor?space=${spaceId}`), 900);
    return () => clearTimeout(t);
  }, [phase, router, spaceId]);

  async function onResume() {
    if (!view?.resumeJobId) return;
    setBusy(true);
    setActionError(null);
    try {
      await resume({ jobId: view.resumeJobId as Id<"jobs"> });
    } catch (err) {
      setActionError(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't restart the step. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const offline = space?.mode === "offline" || space?.brand?.quality === "offline";
  const stuck = phase === "failed" || phase === "stalled";

  return (
    <div className="scan" id="step-scan" style={brandVars(space?.brand)}>
      <div>
        <div className="tag">
          Orthogonal / scanning
          {offline && (
            <span className="pill inv" title="No provider keys are configured, so labelled offline stand-ins ran instead of live providers.">
              Offline stand-in
            </span>
          )}
        </div>
        <div className="domain-chip">
          {!stuck && <span className="spin" />}
          <span id="scan-host">{host || "your-site.com"}</span>
        </div>
        <h1 style={{ marginTop: 20 }}>
          Reading your
          <br />
          website.
        </h1>
        <div className="bar">
          <i id="scan-bar" style={{ width: `${Math.round((view?.progress ?? 0) * 100)}%` }} />
        </div>
        <ul className="steps" id="scan-steps" aria-live="polite">
          {view?.steps.map((s) => (
            <li key={s.key} className={s.state}>
              <span className="dot" />
              <span>
                {s.text}
                {s.note && <span className={`log ${s.note.kind}`}>{s.note.text}</span>}
              </span>
            </li>
          ))}
        </ul>
        {stuck && (
          <div className="scan-actions">
            <button
              className="btn btn-primary"
              onClick={() => void onResume()}
              disabled={busy || !view?.resumeJobId}
              title={view?.resumeJobId ? undefined : "Available once the step is marked stalled (within a minute)."}
            >
              {phase === "failed" ? "Retry" : "Resume"}
            </button>
            {actionError && <span style={{ fontSize: 13, color: "#ff8a70" }}>{actionError}</span>}
          </div>
        )}
      </div>
      <div className="frame">
        <div className="dots">
          <i style={{ background: "#ff5c39" }} />
          <i style={{ background: "#ffb31f" }} />
          <i style={{ background: "#0e9f6e" }} />
        </div>
        <div className={`page${space?.brand ? " branded" : ""}`} id="scan-page" style={{ opacity: live ? opacity : 1 }}>
          {SKELETON.map((w, i) => (
            <div key={i} className="skl" style={i === 3 ? { width: w, height: 80, borderRadius: 10 } : { width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}
