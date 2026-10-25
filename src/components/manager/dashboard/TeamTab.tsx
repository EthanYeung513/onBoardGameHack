"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useInvite } from "./OverviewTab";
import { avatarText, type TabProps } from "./shared";

export function TeamTab({ space, toast }: TabProps) {
  const data = useQuery(api.dashboard.overview, { spaceId: space._id });
  const invite = useInvite(space, toast);
  const total = data?.coursesTotal ?? 0;
  return (
    <>
      <div className="top">
        <div>
          <h1>Team</h1>
          <p>Hires in this space.</p>
        </div>
        <button className="btn btn-primary" onClick={() => void invite()}>
          + Invite
        </button>
      </div>
      <div className="panel">
        <table className="table" id="team-table">
          <tbody>
            <tr>
              <th>Hire</th>
              <th>Joined</th>
              <th>Buildings</th>
              <th>Coins</th>
              <th>Status</th>
            </tr>
            {data?.hires.map((h) => {
              const p = h.progress;
              const complete = p === 100 || h.status === "complete";
              const active = p > 0 || h.started > 0 || h.status !== "invited";
              return (
                <tr key={h._id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <div className="avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                        {avatarText(h.name)}
                      </div>
                      <div>
                        <b>{h.name}</b>
                        <br />
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>{h.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>{new Date(h.joinedAt).toLocaleDateString()}</td>
                  <td>
                    {h.coursesDone}/{total}
                  </td>
                  <td>{h.coins}</td>
                  <td>
                    <span className={`pill ${active || complete ? "live" : "inv"}`}>{complete ? "Complete" : active ? "Onboarding" : "Invited"}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
