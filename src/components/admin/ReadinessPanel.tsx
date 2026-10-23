"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api";
import type { DocFlag } from "@/services/reporting";

interface Readiness {
  gyms: { id: string; name: string; packTitle: string; cleared: number }[];
  learners: { id: string; name: string; role: string; badges: number; answered: number; gaps: string[] }[];
  activeLearners: number;
  docFlags: DocFlag[];
}

/** Who is ready for what, which gyms too few people have cleared, and which docs hires keep getting wrong. */
export function ReadinessPanel() {
  const [data, setData] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<Readiness>("/api/readiness")
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-red-700">{error}</p>;
  if (!data) return <p>Loading readiness…</p>;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-1 text-xl font-bold">Docs that need attention</h2>
        <p className="mb-3 text-sm text-ink/70">When most hires get a card wrong, the section it cites is probably unclear or missing something.</p>
        {data.docFlags.length === 0 ? (
          <p className="text-ink/70">No flags yet. A card is flagged once at least half of its attempts (and at least two) fail.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.docFlags.map((f) => (
              <li key={f.cardId} className="rounded border-2 border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-semibold">
                  ⚠ {f.fails} of {f.attempts} attempts failed · {f.gymName}
                </p>
                <p className="italic">{f.prompt}</p>
                {f.docTitle && (
                  <p className="text-ink/70">
                    Check: {f.docTitle} › {f.heading}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Gym coverage</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink/20 text-left">
                <th className="py-2 pr-3">Gym</th>
                <th className="py-2 pr-3">Pack</th>
                <th className="py-2">Hires cleared</th>
              </tr>
            </thead>
            <tbody>
              {data.gyms.map((g) => (
                <tr key={g.id} className="border-b border-ink/10">
                  <td className="py-2 pr-3 font-semibold">{g.name}</td>
                  <td className="py-2 pr-3">{g.packTitle}</td>
                  <td className="py-2 tabular-nums">
                    {g.cleared} of {data.activeLearners}
                    {g.cleared === 0 && data.activeLearners > 0 && <span className="ml-2 text-red-800">⚠ nobody qualified yet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">Hires</h2>
        {data.learners.length === 0 ? (
          <p className="text-ink/70">Nobody has played yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-ink/20 text-left">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Badges</th>
                  <th className="py-2 pr-3">Gaps</th>
                  <th className="py-2">Records</th>
                </tr>
              </thead>
              <tbody>
                {data.learners.map((l) => (
                  <tr key={l.id} className="border-b border-ink/10">
                    <td className="py-2 pr-3 font-semibold">{l.name}</td>
                    <td className="py-2 pr-3">{l.role}</td>
                    <td className="py-2 pr-3 tabular-nums">{l.badges}</td>
                    <td className="py-2 pr-3">{l.gaps.length ? l.gaps.join(", ") : <span className="text-ink/60">none</span>}</td>
                    <td className="py-2">
                      <a href={`/api/xapi?learnerId=${l.id}`} className="underline">
                        xAPI ({l.answered})
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
