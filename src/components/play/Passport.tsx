"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import type { Passport as PassportData } from "@/services/reporting";

/** The hire's skills passport, opened from Your Desk on the map. */
export function Passport({ learnerId }: { learnerId: string }) {
  const [data, setData] = useState<PassportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<PassportData>(`/api/passport?learnerId=${learnerId}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [learnerId]);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p>Opening your passport…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-pixel text-base leading-relaxed">Skills passport</h2>
        <p>
          {data.learner.name} · {data.learner.role}
        </p>
      </div>
      <section>
        <h3 className="mb-2 font-bold">Badges</h3>
        {data.badges.length === 0 ? (
          <p className="text-ink/70">No badges yet. Beat a Gym Leader to earn one.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {data.badges.map((b) => (
              <li key={b.gymName} className="rounded-full bg-gold/40 px-3 py-1 font-semibold">
                🏅 {b.gymName}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink/60">A badge means eligible. Your manager signs off before it counts for real access.</p>
      </section>
      <section>
        <h3 className="mb-2 font-bold">Competencies</h3>
        {data.competencies.length === 0 ? (
          <p className="text-ink/70">Answer some battles to build your record.</p>
        ) : (
          <ul className="grid gap-1 sm:grid-cols-2">
            {data.competencies.map((c) => (
              <li key={c.competency} className="flex items-center justify-between rounded bg-white px-3 py-1.5 text-sm">
                <span>{c.competency}</span>
                <span className={c.status === "shown" ? "font-semibold text-emerald-800" : "font-semibold text-red-800"}>
                  {c.status === "shown" ? "✓ shown" : "✗ gap"} ({c.attempts - c.fails}/{c.attempts})
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {data.attested.length > 0 && (
        <section>
          <h3 className="mb-2 font-bold">Policies passed on</h3>
          <ul className="text-sm">
            {data.attested.map((a) => (
              <li key={a.docTitle}>
                {a.docTitle} <span className="text-ink/60">v{a.version}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <a href={`/api/xapi?learnerId=${learnerId}`} className="self-start text-sm underline">
        Export as xAPI statements (for your LMS)
      </a>
    </div>
  );
}
