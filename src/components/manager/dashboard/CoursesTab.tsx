"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { DeployQr, absoluteUrl } from "@/components/manager/DeployPanel";
import { UpdateCoursesButton, usePendingUpdates } from "./UpdateCourses";
import { Icon } from "@/components/manager/icons";
import type { TabProps } from "./shared";

// "Generate course" queues the default packs the space is missing (generate_courses stage, real
// Mubit). Free-text topics need the assistant (F22, postponed) — the input is kept as designed.
// Publish = Generate → deploy (D-33): #pub-btn deploys this company's own onboarding world (its own
// Vercel project, or the labelled stand-in at /o/<slug>).
export const TOPIC_PENDING = "Custom topics arrive with the course assistant";

export function CoursesTab({ space, toast }: TabProps) {
  const courses = useQuery(api.dashboard.courses, { spaceId: space._id });
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const deploy = useMutation(api.deploy.deployOnboarding);
  const generate = useMutation(api.courses.generate);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const runGenerate = async () => {
    setGenStatus(null);
    try {
      const { queued } = await generate({ spaceId: space._id });
      setGenStatus(queued.length ? `Generating ${queued.length} course${queued.length === 1 ? "" : "s"} from your brain…` : "All standard courses exist.");
    } catch (err) {
      setGenStatus(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't start generation. Please try again.");
    }
  };
  // D-36: courses whose content changed since the last push (detected company changes).
  const pending = usePendingUpdates(space._id);
  const changedIds = new Set<string>((pending?.changed ?? []).map((c) => c.courseId));
  const building = space.deployState === "building";
  const deployUrl = space.deployUrl;
  const published = Boolean(deployUrl);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const playUrl = deployUrl ? absoluteUrl(deployUrl, origin || "http://localhost") : "";
  const publish = async () => {
    try {
      await deploy({ spaceId: space._id });
      toast(published ? "Updating your onboarding world…" : "Publishing your onboarding world…");
    } catch (err) {
      toast(err instanceof ConvexError ? (err.data as { message: string }).message : "Couldn't start publishing. Please try again.");
    }
  };
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
            title={TOPIC_PENDING}
            onKeyDown={(e) => e.key === "Enter" && void runGenerate()}
          />
          <button className="btn btn-dark" id="gen-btn" onClick={() => void runGenerate()} title={TOPIC_PENDING}>
            <Icon name="sparkle" /> Generate course
          </button>
        </div>
        <div id="gen-status" style={{ fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
          {genStatus ?? (space.deployState === "error" && space.deployError ? `Last publish failed: ${space.deployError}` : null)}
        </div>
      </div>
      <div className="panel" id="publish-panel" hidden={!published}>
        <div className="ptitle">
          <h3>
            World published <Icon name="globe" />
          </h3>
          <UpdateCoursesButton spaceId={space._id} onDone={toast} />
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          Share this link with new hires.
        </p>
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
          {space.deployMode === "vercel" ? "Deployed as its own Vercel project" : "Stand-in (served by Orthogonal, Vercel not configured)"}
          {space.deployedAt ? ` · updated ${new Date(space.deployedAt).toLocaleString()}` : ""}
        </p>
        {playUrl && <DeployQr url={playUrl} />}
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
          <button className="btn btn-primary" id="pub-btn" onClick={() => void publish()} disabled={building}>
            {building ? "Publishing…" : published ? "Republish" : "Publish world"} <Icon name="globe" size={15} />
          </button>
        </div>
        <div className="grid2" id="course-cards">
          {courses && courses.length === 0 && (
            <p style={{ color: "var(--muted)" }}>No courses yet.</p>
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
              <h4>
                {c.title}
                {(c.newSteps > 0 || changedIds.has(c._id)) && <span className="pill new" title="Rewritten because your company changed. Not live for hires until you update courses.">New</span>}
              </h4>
              <div className="cb">
                <Icon name="building" size={13} /> {c.building} · {c.game} game
              </div>
              {c.desc && <p>{c.desc}</p>}
              <ul>
                {c.lessons.map((l, i) => (
                  <li key={i}>
                    {l}
                    {c.newLessons.includes(l) && <span className="pill new">New</span>}
                  </li>
                ))}
              </ul>
              {c.needsRefresh ? (
                <span className="pill inv" style={{ alignSelf: "flex-start" }} title="Brain facts this course teaches changed">
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
