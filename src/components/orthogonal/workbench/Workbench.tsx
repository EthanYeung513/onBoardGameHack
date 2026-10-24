"use client";

import { useEffect, useState } from "react";
import { orthogonalApi } from "@/lib/orthogonal/client";
import { retheme, rethemeBackground } from "@/lib/orthogonal/theme";
import type { ConnectorId, Project, ShipRequest, Step, StepKind } from "@/lib/orthogonal/types";
import { LogLine, Logo, SectionLabel } from "../ui";
import { useTicker } from "../useTicker";
import { Inspector } from "./Inspector";
import { KIND_LABEL, withKind } from "./kinds";
import { StepPreview } from "./StepPreview";

type Device = "desktop" | "mobile";
type Notice = { title: string; detail: string; error?: boolean };

/**
 * The constructor. Plays back the build log as the steps appear, then opens the editor: step list on the left,
 * live preview in the middle, inspector on the right. All edits stay local until Push or Publish sends them.
 */
export function Workbench({ project, speed }: { project: Project; speed: number }) {
  const [phase, setPhase] = useState<"build" | "done">("build");
  const [opening, setOpening] = useState(false);
  const [steps, setSteps] = useState(project.steps);
  const [enabled, setEnabled] = useState(() => Object.fromEntries(project.connectors.map((c) => [c.id, c.enabled])) as Record<ConnectorId, boolean>);
  const [device, setDevice] = useState<Device>("desktop");
  const [shipped, setShipped] = useState<"push" | "publish" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Which step the preview shows, and how many steps existed when it was chosen (see `cur` below).
  const [nav, setNav] = useState({ cur: 0, at: 0 });

  const logged = useTicker(project.log.length, 1350 * speed, 1750 * speed, () => {
    setPhase("done");
    setNav({ cur: 0, at: steps.length });
    setOpening(true);
  });
  const done = phase === "done";
  const built = done ? steps.length : Math.max(0, ...project.log.slice(0, logged).map((e) => e.step ?? 0));

  // While building, the preview follows the newest step; navigation only sticks until the next one lands.
  const cur = nav.at === built ? nav.cur : Math.max(0, built - 1);
  const go = (i: number) => setNav({ cur: Math.min(Math.max(i, 0), Math.max(0, built - 1)), at: built });

  useEffect(() => {
    if (!opening) return;
    const t = setTimeout(() => setOpening(false), 1700);
    return () => clearTimeout(t);
  }, [opening]);

  const updateStep = (fn: (s: Step) => Step) => setSteps((all) => all.map((s, i) => (i === cur ? fn(s) : s)));
  const totalXp = steps.reduce((sum, s) => sum + s.xp, 0);

  const ship = async (action: "push" | "publish") => {
    const req: ShipRequest = { siteUrl: project.siteUrl, repo: project.repo, steps, connectors: enabled };
    setBusy(true);
    try {
      if (action === "push") {
        const r = await orthogonalApi.push(project.id, req);
        setNotice({ title: "Pull request opened", detail: `github.com/${r.repo} · ${r.branch}` });
      } else {
        const r = await orthogonalApi.publish(project.id, req);
        setNotice({
          title: r.via === "vercel" ? "Deployed with Vercel" : "Published",
          detail: r.host + (r.storage === "supabase" ? " · progress stored in Supabase" : ""),
        });
      }
      setShipped(action);
    } catch (err) {
      setNotice({ title: action === "push" ? "Couldn't push to GitHub" : "Couldn't publish", detail: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col lg:h-screen lg:overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <Logo size={16} trail={`/ ${project.siteName} onboarding`} />
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold text-carbon ${done ? "bg-marigold" : "bg-azure"}`}>
            {done ? "Ready" : `Building ${built}/${steps.length}`}
          </span>
        </div>
        {done && (
          <div className="flex flex-wrap items-center gap-2">
            {project.studioUrl && (
              <a href={project.studioUrl} className="mr-1 text-sm font-semibold text-white/70 hover:text-white" data-testid="open-studio">
                Open in studio
              </a>
            )}
            <div role="group" aria-label="Preview size" className="flex gap-0.5 rounded-[9px] bg-white/8 p-[3px]">
              {(["desktop", "mobile"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={device === d}
                  onClick={() => setDevice(d)}
                  className={`h-[30px] cursor-pointer rounded-[7px] border-0 px-3 text-[13px] font-semibold capitalize ${device === d ? "bg-white text-carbon" : "bg-transparent text-white/70"}`}
                >
                  {d}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => ship("push")}
              className={`h-[38px] cursor-pointer rounded-[10px] border border-white/20 px-3.5 text-sm font-semibold text-white disabled:cursor-wait ${shipped === "push" ? "bg-white/12" : "bg-transparent"}`}
            >
              {shipped === "push" ? "Pushed to GitHub" : "Push to GitHub"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => ship("publish")}
              className="h-[38px] cursor-pointer rounded-[10px] border-0 bg-marigold px-4 text-sm font-semibold text-carbon hover:bg-marigold-soft disabled:cursor-wait"
            >
              {shipped === "publish" ? "Published" : "Publish"}
            </button>
          </div>
        )}
      </header>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${done ? "lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(300px,360px)]" : "lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]"}`}
      >
        <aside className="flex min-h-0 flex-col overflow-y-auto border-white/10 lg:border-r">
          {done ? (
            <>
              <div className="border-b border-white/10 px-5 pt-5 pb-4">
                <SectionLabel>Project</SectionLabel>
                <div className="text-lg font-semibold tracking-[-.01em]">{project.siteName} onboarding</div>
                <div className="mt-1 text-[13px] text-white/50">
                  {[project.siteUrl, `${steps.length} steps`, `${totalXp} XP`, project.repo && `github.com/${project.repo}`].filter(Boolean).join(" · ")}
                </div>
              </div>
              <nav aria-label="Steps" className="flex flex-col gap-1 px-3 pt-[18px] pb-5">
                <div className="px-2">
                  <SectionLabel>Steps</SectionLabel>
                </div>
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === cur ? "step" : undefined}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-white hover:bg-white/10 ${i === cur ? "border-white/18 bg-white/8" : "border-transparent bg-transparent"}`}
                  >
                    <span
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold"
                      style={{ background: s.theme.bg, color: s.theme.fg }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{s.title}</span>
                      <span className="block text-xs text-white/50">
                        {KIND_LABEL[s.kind]} · +{s.xp} XP
                      </span>
                    </span>
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <>
              <div className="px-6 pt-[22px] pb-2.5 text-[13px] font-semibold text-white/50">Agent</div>
              <ul aria-live="polite" className="m-0 flex list-none flex-col gap-3 px-6 pt-0 pb-6 text-sm">
                {project.log.slice(0, Math.min(logged + 1, project.log.length)).map((e, i) => (
                  <LogLine key={i} text={e.text} done={i < logged} size="sm" />
                ))}
              </ul>
            </>
          )}
        </aside>

        <main className="relative flex min-w-0 flex-col items-center gap-[18px] overflow-y-auto bg-graphite px-6 py-8">
          <StepPreview
            steps={steps}
            cur={cur}
            built={built}
            levels={project.levels}
            siteUrl={project.siteUrl}
            badgeColor={project.brand.accent}
            width={device === "mobile" ? 400 : 760}
            editable={done}
            celebrate={done && steps[cur].kind === "done"}
            onEdit={(field, value) => updateStep((s) => ({ ...s, [field]: value }))}
            onPrev={() => go(cur - 1)}
            onNext={() => go(cur + 1)}
          />
          {done && (
            <p className="m-0 text-[13px] text-white/45">
              Step {cur + 1} of {steps.length} · click any text to edit · design controls on the right
            </p>
          )}
          {notice && (
            <div
              role="status"
              className="absolute right-6 bottom-6 flex max-w-[calc(100%-48px)] animate-[o-fade-up_.4s_ease_both] items-center gap-3 rounded-[14px] bg-white px-[18px] py-3.5 text-sm text-carbon shadow-[0_20px_50px_rgba(0,0,0,.4)]"
            >
              <span className={`inline-flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs font-bold ${notice.error ? "bg-coral text-white" : "bg-marigold"}`}>
                {notice.error ? "!" : "✓"}
              </span>
              <div>
                <div className="font-semibold">{notice.title}</div>
                <div className="text-[13px] text-black/55">{notice.detail}</div>
              </div>
            </div>
          )}
        </main>

        {done && (
          <Inspector
            projectId={project.id}
            siteUrl={project.siteUrl}
            assets={project.assets}
            palette={project.palette}
            typography={project.typography}
            step={steps[cur]}
            stepNumber={cur + 1}
            connectors={project.connectors}
            enabled={enabled}
            onBackground={(hex) => updateStep((s) => rethemeBackground(s, project.brand, hex))}
            onAccent={(hex) => updateStep((s) => retheme(s, project.brand, s.theme.bg, hex))}
            onKind={(kind: StepKind) => updateStep((s) => withKind(s, kind, steps))}
            onStep={(patch) => updateStep((s) => ({ ...s, ...patch }))}
            onToggleConnector={(id) => setEnabled((e) => ({ ...e, [id]: !e[id] }))}
          />
        )}
      </div>

      {opening && (
        <div className="fixed inset-0 z-10 grid animate-[o-pop_.4s_ease_both] place-items-center bg-marigold text-carbon">
          <div className="p-6 text-center">
            <div className="mb-3 text-[13px] font-semibold tracking-[.06em] uppercase opacity-60">Onboarding ready</div>
            <div className="animate-[o-fade-up_.6s_ease_both] text-[clamp(32px,5vw,56px)] leading-none font-semibold tracking-[-.03em]">Opening the constructor.</div>
          </div>
        </div>
      )}
    </div>
  );
}
