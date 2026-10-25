"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Icon } from "@/components/manager/icons";
import type { TabProps } from "./shared";

// Course generation (S11) and publishing (S14) land in their own PRs: their controls stay exactly
// as designed, disabled with an honest tooltip, so nothing here pretends to generate or publish.
export const GEN_PENDING = "Course generation is coming online";
export const PUBLISH_PENDING = "Publishing is coming online";

export function CoursesTab({ space, toast }: TabProps) {
  const courses = useQuery(api.dashboard.courses, { spaceId: space._id });
  const router = useRouter();
  const [topic, setTopic] = useState("");
  // DEPLOY HOOK SLOT: the orchestrator's `api.deploy.deployOnboarding({ spaceId })` will set
  // `space.deployUrl` (+ QR). Until that lands on base, #pub-btn stays disabled with PUBLISH_PENDING;
  // wire it by calling the mutation from #pub-btn's onClick and dropping `disabled`.
  const deployUrl = (space as { deployUrl?: string }).deployUrl;
  const published = Boolean(space.publishedAt || deployUrl);
  const joinUrl = typeof window === "undefined" ? `/join/${space.slug}` : `${window.location.origin}/join/${space.slug}`;
  const playUrl = deployUrl ?? joinUrl;
  const open = (id: string) => router.push(`/course?id=${encodeURIComponent(id)}`);

  return (
    <>
      <div className="top">
        <div>
          <h1>Courses</h1>
          <p>Curriculum generated from your company brain.</p>
        </div>
      </div>
      <div className="panel">
        <h3>Create a course</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            id="ai-course"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}
            placeholder="e.g. Security best practices"
            onKeyDown={(e) => e.key === "Enter" && toast(GEN_PENDING)}
          />
          <span title={GEN_PENDING} style={{ display: "inline-flex" }}>
            <button className="btn btn-dark" id="gen-btn" disabled title={GEN_PENDING}>
              <Icon name="sparkle" /> Generate course
            </button>
          </span>
        </div>
        <div id="gen-status" style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }} />
      </div>
      <div className="panel" id="publish-panel" hidden={!published}>
        <h3>
          World published <Icon name="globe" />
        </h3>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          Share this link with new hires — they&apos;ll log in with their company email.
        </p>
        <div className="linkbox">
          <span id="play-link">{playUrl}</span>
          <button
            className="btn btn-dark"
            onClick={() => {
              void navigator.clipboard?.writeText(playUrl).catch(() => undefined);
              toast("Link copied");
            }}
          >
            Copy
          </button>
          <a className="btn btn-primary" id="play-open" target="_blank" rel="noreferrer" href={playUrl}>
            Open world →
          </a>
        </div>
      </div>
      <div className="panel" id="gen-panel">
        <div className="ptitle">
          <h3>Curriculum</h3>
          <span title={PUBLISH_PENDING} style={{ display: "inline-flex" }}>
            <button className="btn btn-primary" id="pub-btn" disabled title={PUBLISH_PENDING}>
              {published ? "Republish" : "Publish world"} <Icon name="globe" size={15} />
            </button>
          </span>
        </div>
        <div className="grid2" id="course-cards">
          {courses && courses.length === 0 && (
            <p style={{ color: "var(--muted)" }}>No courses yet — they are generated from your company brain.</p>
          )}
          {courses?.map((c) => (
            <div
              key={c._id}
              className="course-card"
              style={{ cursor: "pointer" }}
              role="link"
              tabIndex={0}
              onClick={() => open(c._id)}
              onKeyDown={(e) => e.key === "Enter" && open(c._id)}
            >
              <div className="ci">
                <Icon name={c.icon} size={30} />
              </div>
              <h4>{c.title}</h4>
              <div className="cb">
                <Icon name="building" size={13} /> {c.building} · {c.game} game
              </div>
              {c.desc && <p>{c.desc}</p>}
              <ul>
                {c.lessons.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              {c.needsRefresh ? (
                <span className="pill inv" style={{ alignSelf: "flex-start" }} title="Brain facts this course teaches changed — regenerate to refresh it">
                  Needs refresh{c.staleSteps > 0 ? ` · ${c.staleSteps} step${c.staleSteps === 1 ? "" : "s"}` : ""}
                </span>
              ) : (
                <span className="pill live" style={{ alignSelf: "flex-start" }}>
                  Generated ✓
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
