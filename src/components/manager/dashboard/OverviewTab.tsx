"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { FormModal } from "./FormModal";
import { avatarText, errMsg, type Space, type TabProps, type Toast } from "./shared";

/** "+ Invite" (mockup `invite()`): an in-page email field → real invite → copy the hire's link. */
export function useInvite(space: Space, toast: Toast): { open: () => void; modal: ReactNode } {
  const invite = useMutation(api.hires.invite);
  const [shown, setShown] = useState(false);
  const modal = shown ? (
    <FormModal
      title="Invite a hire"
      sub="They get a link to your onboarding world; you can share it however you like."
      fields={[{ name: "email", label: "Work email", type: "email", placeholder: "name@company.com", required: true }]}
      submitLabel="Create invite"
      onClose={() => setShown(false)}
      onSubmit={async ({ email }) => {
        try {
          const { path } = await invite({ spaceId: space._id, email });
          const link = `${window.location.origin}${path}`;
          await navigator.clipboard?.writeText(link).catch(() => undefined);
          toast("Invite link copied — email sending not set up yet");
          return null;
        } catch (err) {
          return errMsg(err);
        }
      }}
    />
  ) : null;
  return { open: () => setShown(true), modal };
}

export function OverviewTab({ space, toast, managerName, brandPill }: TabProps & { managerName: string; brandPill: string }) {
  const data = useQuery(api.dashboard.overview, { spaceId: space._id });
  const invite = useInvite(space, toast);
  const k = data?.kpis ?? { facts: 0, team: 0, courses: 0, onTrack: 0 };
  const kpis: [string, string | number, string][] = [
    ["Knowledge hub", k.facts, "facts learned"],
    ["Team members", k.team, "hires & invites"],
    ["Courses", k.courses, "in curriculum"],
    ["On-track rate", `${k.onTrack}%`, "hires completed"],
  ];
  const total = data?.coursesTotal ?? 0;

  return (
    <>
      {invite.modal}
      <div className="top">
        <div>
          <h1 id="hello">Welcome, {managerName || "Manager"}</h1>
          <p>Supercharge your team&apos;s onboarding experience today.</p>
        </div>
        <span className="pill" id="brand-pill">
          {brandPill}
        </span>
      </div>
      <div className="cards" id="kpis">
        {kpis.map(([t, v, s]) => (
          <div className="kpi" key={t}>
            <div className="t">{t}</div>
            <div className="v">{v}</div>
            <div className="s">{s}</div>
          </div>
        ))}
      </div>
      <div className="ptitle">
        <h3>Team onboarding overview</h3>
        <button className="btn btn-ghost" onClick={invite.open}>
          + Invite
        </button>
      </div>
      <div className="grid2" id="hire-cards">
        {data && data.hires.length === 0 && <p style={{ color: "var(--muted)" }}>No hires yet — publish your world and share the link.</p>}
        {data?.hires.map((h) => {
          const p = h.progress;
          const active = p > 0 || h.started > 0 || h.status !== "invited";
          return (
            <div className="hire-card" key={h._id}>
              <div className="hd">
                <div className="avatar">{avatarText(h.name)}</div>
                <div>
                  <b>{h.name}</b>
                  <span>{h.email}</span>
                </div>
                <span className="pill" style={{ marginLeft: "auto" }}>
                  {p === 100 || h.status === "complete" ? "Done" : "New hire"}
                </span>
              </div>
              <div className="meta">
                <span>Progress</span>
                <b style={{ marginLeft: "auto" }}>{p}%</b>
              </div>
              <div className="pbar">
                <i style={{ width: `${p}%` }} />
              </div>
              <div className="meta">
                <span>
                  {h.coursesDone}/{total} buildings
                </span>
                <span>Coins: {h.coins}</span>
                <span className={`pill ${active ? "live" : "inv"}`}>{active ? "Onboarding" : "Invited"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
