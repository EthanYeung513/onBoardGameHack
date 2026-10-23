"use client";

import { useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api";
import type { DocUpdateResult } from "@/services/refresh";

interface DocRow {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  packTitle: string;
  staleCards: number;
}

const ROLES = ["Operations", "Customer Support", "Engineering", "Sales", "Everyone"];

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `PUT ${url} failed`);
  return res.json();
}

/** Fast refresh: edit a policy (citing cards go stale and regenerate) or upload a new pack (a new gym opens). */
export function ContentPanel() {
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [reloads, setReloads] = useState(0);
  const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJson<{ docs: DocRow[] }>("/api/docs")
      .then(({ docs }) => !cancelled && setDocs(docs))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [reloads]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      setMessage(await fn());
      setReloads((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-1 text-xl font-bold">Policy documents</h2>
        <p className="mb-3 text-sm text-ink/70">Edit a policy and every card citing a changed section goes stale: players stop seeing it until it&apos;s regenerated and approved.</p>
        {!docs && !error && <p>Loading…</p>}
        {docs && (
          <ul className="flex flex-col gap-2">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded border-2 border-ink/10 bg-white p-3">
                <div>
                  <p className="font-semibold">{d.title}</p>
                  <p className="text-sm text-ink/60">
                    {d.packTitle} · v{d.version}
                    {d.staleCards > 0 && <span className="ml-2 rounded bg-amber-200 px-1.5 text-amber-900">⚠ {d.staleCards} stale card(s)</span>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {d.staleCards > 0 && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          const r = await postJson<{ regenerated: number; retired: number }>(`/api/docs/${d.id}/regenerate`, {});
                          return `Regenerated ${r.regenerated} card(s) from the new wording. They're waiting in the review queue.`;
                        })
                      }
                      className="rounded bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      Regenerate stale cards
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => run(async () => {
                      const doc = await getJson<{ id: string; title: string; body: string }>(`/api/docs/${d.id}`);
                      setEditing(doc);
                      return `Editing ${doc.title}`;
                    })}
                    className="rounded border-2 border-ink px-3 py-1.5 font-semibold"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <form
            className="mt-4 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const r = await putJson<DocUpdateResult>(`/api/docs/${editing.id}`, { body: editing.body });
                setEditing(null);
                return `Saved v${r.version}. ${r.staleCards} card(s) went stale, ${r.carriedOver} carried over unchanged, ${r.flaggedCorrections} past correction(s) flagged for re-review.`;
              });
            }}
          >
            <label className="font-semibold" htmlFor="doc-body">
              {editing.title}
            </label>
            <textarea id="doc-body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={16} className="rounded border-2 border-ink/30 p-3 font-mono text-sm" />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="rounded bg-ink px-4 py-2 font-semibold text-paper disabled:opacity-50">
                Save new version
              </button>
              <button type="button" onClick={() => setEditing(null)} className="px-4 py-2">
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <UploadPack busy={busy} run={run} />

      {message && (
        <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">
          {message}
        </p>
      )}
      {error && <p className="rounded bg-red-50 p-3 text-red-800">{error}</p>}
    </div>
  );
}

function UploadPack({ busy, run }: { busy: boolean; run: (fn: () => Promise<string>) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [gymName, setGymName] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [publish, setPublish] = useState(true);

  return (
    <section>
      <h2 className="mb-1 text-xl font-bold">Upload a new content pack</h2>
      <p className="mb-3 text-sm text-ink/70">Any role, any domain. Each section (## heading) becomes a card; the gym moves into the locked building on the map.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const started = performance.now();
            const r = await postJson<{ gym: { name: string; locked: boolean }; cards: number }>("/api/packs", {
              title,
              role: role === "Everyone" ? null : role,
              markdown,
              gymName: gymName || undefined,
              leaderName: leaderName || undefined,
              publish,
            });
            const secs = ((performance.now() - started) / 1000).toFixed(1);
            return r.gym.locked
              ? `${r.gym.name} created with ${r.cards} draft cards in ${secs}s. Approve them in the review queue to open the door.`
              : `${r.gym.name} is open in the annex with ${r.cards} cards, generated in ${secs}s.`;
          });
        }}
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              const s = await getJson<{ title: string; role: string; gymName: string; leaderName: string; markdown: string }>("/api/packs/sample");
              setTitle(s.title);
              setRole(s.role);
              setGymName(s.gymName);
              setLeaderName(s.leaderName);
              setMarkdown(s.markdown);
            }}
            className="rounded border-2 border-ink/40 px-3 py-1.5 text-sm"
          >
            Load sample: Warehouse Ops
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Pack title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required className="rounded border-2 border-ink/30 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2">
              {ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Gym name (optional)</span>
            <input value={gymName} onChange={(e) => setGymName(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Gym Leader (optional)</span>
            <input value={leaderName} onChange={(e) => setLeaderName(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2" />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Document (markdown)</span>
          <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} rows={10} required className="rounded border-2 border-ink/30 p-3 font-mono text-sm" placeholder={"# Handbook\n\n## First section\n- A rule\n\n## Second section\n- Another rule"} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!publish} onChange={(e) => setPublish(!e.target.checked)} />
          Review cards before the gym opens
        </label>
        <button type="submit" disabled={busy || !title || !markdown} className="self-start rounded bg-ink px-4 py-2 font-semibold text-paper disabled:opacity-50">
          {busy ? "Generating…" : "Generate gym"}
        </button>
      </form>
    </section>
  );
}
