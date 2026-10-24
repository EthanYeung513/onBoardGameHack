"use client";
import { useState } from "react";
import type { ProjectState } from "@/lib/pipeline/state";

export function Questions({ state, editable, onSaved }: { state: ProjectState; editable: boolean; onSaved: () => void }) {
  const saved = Object.fromEntries(state.answers.map((a) => [a.question_key, a.answer]));
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/gen/projects/${state.project.id}/answers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "Could not save the answers");
    onSaved();
  }

  return (
    <section className="g-panel space-y-5 p-5" aria-labelledby="q-h" data-testid="questions">
      <div>
        <h2 id="q-h" className="text-2xl font-bold">
          A few questions
        </h2>
        <p className="g-muted text-sm">Your answers shape all three flows.</p>
      </div>
      <ol className="space-y-6">
        {state.questions.map((q, i) => {
          const options: string[] = Array.isArray(q.options) ? q.options : [];
          const value = answers[q.question_key];
          return (
            <li key={q.id} className="space-y-2" data-testid={`question-${q.question_key}`}>
              <p className="font-semibold">
                {i + 1}. {q.prompt}
              </p>
              {options.length > 0 ? (
                <div className="flex flex-wrap gap-2" role={q.kind === "multi" ? "group" : "radiogroup"} aria-label={q.prompt}>
                  {options.map((o) => {
                    const on = q.kind === "multi" ? Array.isArray(value) && value.includes(o) : value === o;
                    return (
                      <button
                        key={o}
                        type="button"
                        role={q.kind === "multi" ? "checkbox" : "radio"}
                        aria-checked={on}
                        disabled={!editable}
                        className="rounded-full border px-3 py-1.5 text-sm"
                        style={{ background: on ? "var(--g-ink)" : "var(--g-surface)", color: on ? "#fff" : "var(--g-ink)", borderColor: on ? "var(--g-ink)" : "var(--g-line)" }}
                        onClick={() => {
                          if (q.kind === "multi") {
                            const cur = Array.isArray(value) ? value : [];
                            setAnswers({ ...answers, [q.question_key]: on ? cur.filter((x) => x !== o) : [...cur, o] });
                          } else setAnswers({ ...answers, [q.question_key]: o });
                        }}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input className="g-input" value={typeof value === "string" ? value : ""} disabled={!editable} onChange={(e) => setAnswers({ ...answers, [q.question_key]: e.target.value })} />
              )}
            </li>
          );
        })}
      </ol>
      {error && <p role="alert" style={{ color: "var(--g-danger)" }}>{error}</p>}
      {editable && (
        <button className="g-btn" onClick={submit} disabled={busy || Object.keys(answers).length === 0} data-testid="submit-answers">
          {busy ? "Saving" : "Generate flows"}
        </button>
      )}
    </section>
  );
}
