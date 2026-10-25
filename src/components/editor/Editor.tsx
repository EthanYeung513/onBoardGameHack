"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { EditorAsset } from "@convex/editor";
import { initials } from "@/components/manager/brand";
import { currentDesign, decisionValue, designVars, errorMessage, radiusPx, type DesignValues } from "@/lib/editor/design";
import { AssetsPanel } from "./AssetsPanel";
import { brandFns, courseFns, type BrandField, type BrandOptions, type CoursePatch } from "./contracts";
import { DesignPanel } from "./DesignPanel";
import { Preview, type SpecStep } from "./Preview";
import { StepsList, staleLine } from "./StepsList";

// editor.html on real data: steps + preview from the course's CourseSpec, click-to-edit through
// validated patches, Assets from the scan, Design from learned brand recommendations.

export type EditorData = FunctionReturnType<typeof api.editor.load>;

type Props = {
  spaceId: Id<"spaces">;
  data: EditorData;
  assets: { host: string; assets: EditorAsset[] } | undefined;
  /** undefined = loading, null = brand learning unavailable (controls stay bound to brand tokens). */
  options: BrandOptions | null | undefined;
};

const DECIDE_DEBOUNCE_MS = 700;

function useToast() {
  const [toast, setToast] = useState<{ msg: string; show: boolean }>({ msg: "", show: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setToast({ msg, show: true });
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 3200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show] as const;
}

export function Editor({ spaceId, data, assets, options }: Props) {
  const router = useRouter();
  const applyPatch = useMutation(courseFns.applyPatch);
  const regenerateSteps = useMutation(courseFns.regenerateSteps);
  const decide = useMutation(brandFns.decide);
  const [toast, showToast] = useToast();
  const [cur, setCur] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [tab, setTab] = useState<"assets" | "design">("assets");
  const [picked, setPicked] = useState<EditorAsset | null>(null);
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [picks, setPicks] = useState<Partial<DesignValues>>({});
  const timers = useRef<Partial<Record<BrandField, ReturnType<typeof setTimeout>>>>({});

  const { space, brand, course } = data;
  const steps: SpecStep[] = Array.isArray(course?.spec?.steps) ? course.spec.steps : [];
  const stale = course?.staleSteps ?? {};
  // Headline = the heading font family once brand learning is live; the mockup's presets otherwise.
  const design = currentDesign(brand, picks, options?.fields.headline?.current ?? (options ? brand?.typography.heading.family : undefined));
  const step = steps[Math.min(cur, steps.length - 1)];
  const host = space.host.replace(/^www\./, "");

  // Refresh requests are keyed by course version: regeneration bumps it, so a step that goes stale
  // again later shows its button rather than an old spinner.
  const refreshKey = (stepId: string) => `${course?.version}:${stepId}`;
  const refreshingNow = new Set(steps.map((s) => s.id).filter((id) => refreshing.has(refreshKey(id))));

  async function onPatch(patch: CoursePatch): Promise<boolean> {
    if (!course) return false;
    try {
      await applyPatch({ courseId: course._id, version: course.version, patches: [patch] });
      return true;
    } catch (err) {
      showToast(errorMessage(err, "Save the edit"));
      return false;
    }
  }

  async function onRefresh(stepId: string) {
    if (!course) return;
    const key = refreshKey(stepId);
    setRefreshing((r) => new Set(r).add(key));
    try {
      await regenerateSteps({ courseId: course._id, stepIds: [stepId] });
      showToast("Refreshing this step from the latest sources…");
    } catch (err) {
      setRefreshing((r) => new Set([...r].filter((k) => k !== key)));
      showToast(errorMessage(err, "Refresh the step"));
    }
  }

  function record(field: BrandField, next: DesignValues) {
    const recommended = options?.fields[field]?.recommended;
    decide({ spaceId, field, chosen: decisionValue(field, next), ...(recommended ? { recommended } : {}) }).catch((err) => showToast(errorMessage(err, "Save the design choice")));
  }

  function setField(field: BrandField, value: string, debounce: boolean) {
    const val = field === "radius" ? radiusPx(value) : value;
    const next = { ...design, [field]: val } as DesignValues;
    setPicks((p) => ({ ...p, [field]: val }));
    clearTimeout(timers.current[field]);
    if (debounce) timers.current[field] = setTimeout(() => record(field, next), DECIDE_DEBOUNCE_MS);
    else record(field, next);
  }

  return (
    <div className={`ed${mobile ? " mobile" : ""}`} style={designVars(brand, design)}>
      <div className="top">
        <div className="mark">{initials(space.name).slice(0, 1)}</div>
        <div className="crumb">
          Orthogonal <span>/</span> <span>{space.name} onboarding</span>
        </div>
        {course ? <span className="pill-ready">Ready</span> : data.generating ? <span className="pill-ready">Generating</span> : null}
        <div className="right">
          <div className="seg">
            <button className={mobile ? "" : "on"} onClick={() => setMobile(false)}>
              Desktop
            </button>
            <button className={mobile ? "on" : ""} onClick={() => setMobile(true)}>
              Mobile
            </button>
          </div>
          <button className="btn-cont" onClick={() => router.push(`/dashboard?space=${spaceId}`)}>
            Continue →
          </button>
        </div>
      </div>
      <div className="wrap">
        <div className="steps">
          <StepsList steps={steps} cur={cur} stale={stale} refreshing={refreshingNow} onPick={setCur} onRefresh={(id) => void onRefresh(id)} />
        </div>
        <div className="center">
          {step && stale[step.id] && (
            <div className="stale-note" role="status">
              <span className="stale-pill">Needs refresh</span> {staleLine(stale[step.id])}
            </div>
          )}
          <div className="browser">
            <div className="bchrome">
              <span className="d" style={{ background: "#ff5c39" }} />
              <span className="d" style={{ background: "#ffb31f" }} />
              <span className="d" style={{ background: "#0e9f6e" }} />
              <div className="url">app.{host}/welcome</div>
            </div>
            <div className="bpage">
              {course && step ? (
                <Preview steps={steps} cur={steps.indexOf(step)} building={course.building} onPatch={onPatch} />
              ) : (
                <EmptyPage generating={data.generating} />
              )}
            </div>
          </div>
          {course && step && (
            <div className="caption">
              Step {steps.indexOf(step) + 1} of {steps.length} · click any text to edit · design controls on the right
            </div>
          )}
        </div>
        <div className="side">
          <div className="tabs">
            <button className={tab === "assets" ? "on" : ""} onClick={() => setTab("assets")}>
              Assets
            </button>
            <button className={tab === "design" ? "on" : ""} onClick={() => setTab("design")}>
              Design
            </button>
          </div>
          <div className="body">
            {tab === "assets" ? (
              <AssetsPanel host={assets?.host ?? host} assets={assets?.assets} selected={picked?.id ?? null} onSelect={setPicked} />
            ) : (
              <DesignPanel
                options={options}
                design={design}
                onPreview={(f, v) => setField(f, v, true)}
                onPick={(f, v) => setField(f, v, false)}
              />
            )}
          </div>
          <div className="foot">
            {picked?.foundAt ? (
              <>
                <b>{picked.name}</b> found at{" "}
                <a href={picked.foundAt} target="_blank" rel="noreferrer">
                  {shortUrl(picked.foundAt)}
                </a>
              </>
            ) : (
              "Select an asset to see where it was found. Drag one onto the preview to use it in the current step."
            )}
          </div>
        </div>
      </div>
      <div className={`toast${toast.show ? " show" : ""}`} role="status" aria-live="polite">
        {toast.msg}
      </div>
    </div>
  );
}

function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "");
  return bare.length > 48 ? `${bare.slice(0, 30)}…${bare.slice(-15)}` : bare;
}

function EmptyPage({ generating }: { generating: EditorData["generating"] }) {
  return (
    <>
      <div className="stepno">{generating ? `Building your courses · ${Math.round(generating.progress * 100)}%` : "No courses yet"}</div>
      <h2>{generating ? "Writing your onboarding…" : "Your courses will appear here."}</h2>
      <div className="bsub">
        {generating
          ? "Our agents are turning your company brain into courses. Each one shows up here as soon as it's ready."
          : "Courses are written from your company brain once a scan has finished."}
      </div>
      {generating && generating.lines.length > 0 && (
        <div className="opts">
          {generating.lines.map((l, i) => (
            <div className="opt" key={i}>
              {l}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
