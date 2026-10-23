"use client";

import { useEffect, useState } from "react";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { getJson } from "@/lib/api";
import type { Timeline, TimelineVersion } from "@/services/timeline";

type TimelineResponse = Timeline & { mode: "mubit" | "offline"; feedbackSink: "mubit" | "distil" };

const pct = (x: number | null) => (x == null ? "–" : `${(x * 100).toFixed(1)}%`);
const money = (x: number | null) => (x == null ? "–" : `$${x.toFixed(x < 1 ? 3 : 2)}`);

const STATUS: Record<TimelineVersion["status"], { icon: string; label: string; className: string }> = {
  promoted: { icon: "✓", label: "Promoted", className: "bg-emerald-100 text-emerald-900" },
  blocked: { icon: "⛔", label: "Blocked by gate", className: "bg-red-100 text-red-900" },
  candidate: { icon: "○", label: "Superseded", className: "bg-ink/10 text-ink" },
};

/** Corrections in, model versions out: the panel that shows the grader learning. */
export function LearningTimeline({ pollMs = 4000 }: { pollMs?: number }) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getJson<TimelineResponse>("/api/timeline")
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e: Error) => !cancelled && setError(e.message));
    const first = setTimeout(load, 0);
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => {
      cancelled = true;
      clearTimeout(first);
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);

  if (error) return <p className="text-red-700">Couldn&apos;t load the timeline: {error}</p>;
  if (!data) return <p>Loading the learning timeline…</p>;

  const { counts, versions } = data;
  const promoted = versions.find((v) => v.status === "promoted");
  const baseline = versions[0];
  const towardNext = Math.min(counts.grades, data.trainingThreshold);
  const steps = [
    { label: "Grades", value: counts.grades, hint: data.mode === "mubit" ? "every grading call goes through Mubit" : "graded offline (set MUBIT_API_KEY)" },
    { label: "Human verdicts", value: counts.reviewed, hint: `${counts.approvals} approved, ${counts.corrections} corrected` },
    { label: "Corrections", value: counts.corrections, hint: data.feedbackSink === "mubit" ? `${counts.sentToMubit} sent to Mubit` : "applied via the fast path" },
    { label: "Fast-path grades", value: counts.fastPathGrades, hint: "graded with a past ruling retrieved" },
    { label: "Toward next adapter", value: `${towardNext}/${data.trainingThreshold}`, hint: "kept examples before Mubit trains" },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded bg-ink/10 px-2 py-1">LLM: {data.mode === "mubit" ? "Mubit" : "offline baseline (no Mubit key)"}</span>
        <span className="rounded bg-ink/10 px-2 py-1">Corrections: {data.feedbackSink === "mubit" ? "Mubit feedback endpoint" : "fast path + distillation"}</span>
      </div>

      <ol className="grid gap-2 sm:grid-cols-5" aria-label="Learning pipeline">
        {steps.map((s, i) => (
          <li key={s.label} className="relative rounded-lg border-2 border-ink/15 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-ink/60">
              {i + 1}. {s.label}
            </p>
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="text-xs text-ink/60">{s.hint}</p>
          </li>
        ))}
      </ol>

      <section>
        <h2 className="mb-3 text-xl font-bold">Grader versions on the held-out set</h2>
        {versions.length === 0 || versions.every((v) => v.heldOutAgreement == null) ? (
          <p className="text-ink/70">
            No versions measured yet. Run <code className="rounded bg-ink/10 px-1">npm run eval -- --label v0 --record</code> after the manager labels the held-out set.
          </p>
        ) : (
          <>
            {promoted && baseline && promoted.heldOutAgreement != null && (
              <div className="mb-4 grid gap-2 sm:grid-cols-3">
                <Tile label={`Agreement with managers (${promoted.label})`} value={pct(promoted.heldOutAgreement)} sub={promoted !== baseline ? `${baseline.label}: ${pct(baseline.heldOutAgreement)}` : "baseline"} />
                <Tile label="Cost per 1,000 grades" value={money(promoted.costPer1k)} sub={promoted !== baseline ? `${baseline.label}: ${money(baseline.costPer1k)}` : ""} />
                <Tile label="Median latency" value={promoted.p50Ms == null ? "–" : `${promoted.p50Ms}ms`} sub={promoted !== baseline && baseline.p50Ms != null ? `${baseline.label}: ${baseline.p50Ms}ms` : ""} />
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-ink/20 text-left">
                    <th className="py-2 pr-3">Version</th>
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Exact agreement</th>
                    <th className="py-2 pr-3">Within 1</th>
                    <th className="py-2 pr-3">MAE</th>
                    <th className="py-2 pr-3">Cost / 1k</th>
                    <th className="py-2 pr-3">p50</th>
                    <th className="py-2">Gate</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v) => (
                    <tr key={v.label} className="border-b border-ink/10">
                      <td className="py-2 pr-3 font-semibold">{v.label}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{v.model}</td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2" title={`${v.label}: ${pct(v.heldOutAgreement)} exact agreement`}>
                          <div className="h-2.5 w-28 rounded-full bg-ink/10">
                            <div className="h-full rounded-full bg-[#3a5a8c]" style={{ width: `${(v.heldOutAgreement ?? 0) * 100}%` }} />
                          </div>
                          <span className="tabular-nums">{pct(v.heldOutAgreement)}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{pct(v.withinOne)}</td>
                      <td className="py-2 pr-3 tabular-nums">{v.mae?.toFixed(2) ?? "–"}</td>
                      <td className="py-2 pr-3 tabular-nums">{money(v.costPer1k)}</td>
                      <td className="py-2 pr-3 tabular-nums">{v.p50Ms == null ? "–" : `${v.p50Ms}ms`}</td>
                      <td className="py-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS[v.status].className}`}>
                          <span aria-hidden>{STATUS[v.status].icon}</span> {STATUS[v.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-bold">Recent corrections</h2>
          {data.corrections.length === 0 && <p className="text-ink/70">No corrections yet.</p>}
          <ul className="flex flex-col gap-2">
            {data.corrections.map((c) => (
              <li key={c.id} className="rounded border-2 border-ink/10 bg-white p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <ScoreBadge score={c.from} label="AI" /> <span aria-label="corrected to">→</span> <ScoreBadge score={c.to} label={c.reviewer} />
                  <span className="text-ink/60">{c.competency}</span>
                </div>
                <p>{c.reason}</p>
                <p className="text-xs text-ink/50">{c.sentToMubit ? "Sent to Mubit" : "Stored; used by the fast path"}</p>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-3 text-lg font-bold">Live grades</h2>
          {data.liveGrades.length === 0 && <p className="text-ink/70">No grades yet.</p>}
          <ul className="flex flex-col gap-2">
            {data.liveGrades.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 rounded border-2 border-ink/10 bg-white p-3 text-sm">
                <ScoreBadge score={g.score} />
                <span className="font-semibold">{g.learnerName}</span>
                <span className="text-ink/60">{g.competency}</span>
                <span className="text-ink/60">· {g.modelVersion}</span>
                {g.retrievedCorrections > 0 && <span className="rounded bg-sky-100 px-1.5 text-sky-800">fast path: {g.retrievedCorrections} ruling(s)</span>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border-2 border-ink/15 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-ink/60">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-sm text-ink/60">{sub}</p>}
    </div>
  );
}
