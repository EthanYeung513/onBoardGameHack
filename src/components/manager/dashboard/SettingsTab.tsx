"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { BrandInfo } from "./brandInfo";
import { errMsg, type TabProps } from "./shared";

const input = { padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 } as const;
const row = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: 13 } as const;

function BrandPreview({ B, pages }: { B: BrandInfo; pages: number | null }) {
  if (!B.hasBrand)
    return (
      <div className="brand-prev" id="brand-prev">
        <div className="bp-meta">No brand learned yet — re-scan your website to theme the dashboard and world.</div>
      </div>
    );
  return (
    <div className="brand-prev" id="brand-prev">
      <div className="bp-hero" style={{ background: B.bg ?? "var(--ink)" }}>
        <b style={{ color: B.primary ?? "var(--brand)" }}>{B.company}</b>
        <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>Dashboard &amp; world themed to match {B.host}</div>
      </div>
      <div className="bp-meta">
        {[B.primary, B.accent, B.bg].filter(Boolean).map((hex, i) => (
          <span className="swatch" key={i}>
            <i style={{ background: hex! }} />
            {hex}
          </span>
        ))}
        {B.style && <span>Style: {B.style}</span>}
        {pages !== null && <span>Pages read: {pages}</span>}
      </div>
    </div>
  );
}

export function SettingsTab({ space, toast, B, managerName }: TabProps & { B: BrandInfo; managerName: string }) {
  const router = useRouter();
  const scan = useQuery(api.scans.latest, { spaceId: space._id });
  const updateSpace = useMutation(api.spaces.update);
  const updateProfile = useMutation(api.users.updateProfile);
  const reset = useMutation(api.spaces.reset);
  const [name, setName] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);
  const isOwner = space.role === "owner";

  const save = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
    } catch (err) {
      toast(errMsg(err));
    }
  };

  const wipe = async () => {
    if (!window.confirm("Wipe all demo data and start over?")) return;
    try {
      await reset({ spaceId: space._id });
      router.push("/");
    } catch (err) {
      toast(errMsg(err));
    }
  };

  return (
    <>
      <div className="top">
        <div>
          <h1>Settings</h1>
          <p>Space identity and brand.</p>
        </div>
      </div>
      <div className="panel">
        <h3>Brand (learned from your website)</h3>
        <BrandPreview B={B} pages={scan ? scan.pageCount : null} />
      </div>
      <div className="panel">
        <h3>Profile &amp; brain</h3>
        <div style={row}>
          <label htmlFor="mgr-name" style={{ width: 210, color: "var(--muted)" }}>
            Your name
          </label>
          <input id="mgr-name" style={input} value={name ?? managerName} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-ghost" disabled={name === null} onClick={() => void save(() => updateProfile({ name: name ?? "" }), "Name saved")}>
            Save
          </button>
        </div>
        <div style={row}>
          <label htmlFor="auto-approve" style={{ width: 210, color: "var(--muted)" }}>
            Auto-approve facts at confidence ≥
          </label>
          <input
            id="auto-approve"
            type="number"
            min={0}
            max={100}
            style={{ ...input, width: 90 }}
            value={threshold ?? String(Math.round(space.autoApproveThreshold * 100))}
            onChange={(e) => setThreshold(e.target.value)}
          />
          <span style={{ color: "var(--muted)" }}>%</span>
          <button
            className="btn btn-ghost"
            disabled={threshold === null}
            onClick={() => void save(() => updateSpace({ spaceId: space._id, autoApproveThreshold: Number(threshold) / 100 }), "Auto-approve threshold saved")}
          >
            Save
          </button>
        </div>
      </div>
      <div className="panel">
        <h3>Danger zone</h3>
        <button className="btn btn-ghost" onClick={() => router.push(`/space/new?rescan=1&space=${space._id}`)}>
          ↻ Re-scan website
        </button>
        <span title={isOwner ? undefined : "Only the space owner can reset the space"} style={{ display: "inline-flex" }}>
          <button
            className="btn btn-ghost"
            style={{ color: "#dc2626", borderColor: "#dc2626", marginLeft: 10 }}
            disabled={!isOwner}
            onClick={() => void wipe()}
          >
            Reset space (wipe demo data)
          </button>
        </span>
      </div>
    </>
  );
}
