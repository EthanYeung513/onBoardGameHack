"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/manager/icons";
import type { TabProps } from "./shared";

const COIN_SCALE = 500; // the mockup's bar scale: 500 coins = full height

export function AnalyticsTab({ space }: TabProps) {
  const data = useQuery(api.dashboard.analytics, { spaceId: space._id });
  const courses = data?.courses ?? [];
  const hires = data?.hires ?? [];
  return (
    <>
      <div className="top">
        <div>
          <h1>Analytics</h1>
          <p>Progress and scores from the game world.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h3>Course completion</h3>
          <div className="chart" id="chart-courses">
            {courses.map((c) => (
              <div className="col" key={c._id} title={`${c.title}: ${c.completion}% of hires completed`}>
                <i style={{ height: `${Math.max(c.completion, 4)}%` }} />
                <span>{c.title.split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Coins earned vs redeemed</h3>
          <div className="chart" id="chart-coins">
            {hires.map((h) => (
              <div className="col" key={h._id} title={`${h.name}: ${h.coins} coins, ${h.redeemed} redeemed`}>
                <i style={{ height: `${Math.min(100, Math.max((h.coins / COIN_SCALE) * 100, 4))}%` }} />
                <span>{h.name.split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel">
        <h3>Per-hire progress</h3>
        <table className="table" id="analytics-table">
          <tbody>
            <tr>
              <th>Hire</th>
              {courses.map((c) => (
                <th key={c._id}>{c.title}</th>
              ))}
              <th>Total</th>
            </tr>
            {hires.map((h) => (
              <tr key={h._id}>
                <td>
                  <b>{h.name}</b>
                </td>
                {h.scores.map((s, i) => (
                  <td key={courses[i]?._id ?? i}>
                    {s === null ? (
                      "—"
                    ) : (
                      <>
                        <Icon name="check" size={13} /> {s}%
                      </>
                    )}
                  </td>
                ))}
                <td>
                  <b>{h.progress}%</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
