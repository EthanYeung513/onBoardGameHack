"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { gameBus } from "@/game/events";
import { DOORS } from "@/game/map";
import { getJson, postJson } from "@/lib/api";
import type { PublicCard, WorldGym } from "@/services/world";
import { Battle } from "./Battle";
import { GameCanvas } from "./GameCanvas";
import { GymOverlay } from "./GymOverlay";
import { Passport } from "./Passport";

const STORAGE_KEY = "gymquest.learnerId";
const ROLES = ["Customer Support", "Engineering", "Operations", "Sales"];

interface World {
  company: { name: string };
  learner: { id: string; name: string; role: string };
  gyms: WorldGym[];
  locked: string[];
}

type Overlay = { kind: "gym"; gym: WorldGym } | { kind: "wild"; card: PublicCard } | { kind: "desk" } | null;

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function store(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode); the session just won't be remembered.
  }
}

export function PlayApp() {
  const [learnerId, setLearnerId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [world, setWorld] = useState<World | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setLearnerId(readStored());
      setReady(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!learnerId) return;
    let cancelled = false;
    getJson<World>(`/api/world?learnerId=${learnerId}`)
      .then((w) => !cancelled && setWorld(w))
      .catch(() => {
        // Stale id (e.g. after a demo reset): ask the hire to join again.
        if (cancelled) return;
        store(null);
        setLearnerId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [learnerId, reloads]);

  const open = useCallback((next: Overlay) => {
    gameBus.emit("overlay:open", {});
    setOverlay(next);
  }, []);

  const close = useCallback(() => {
    setOverlay(null);
    gameBus.emit("overlay:close", {});
    setReloads((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!world || !learnerId) return;
    const offs = [
      gameBus.on("enter:gym", ({ building }) => {
        if (building === "desk") return open({ kind: "desk" });
        const gym = world.gyms.find((g) => g.building === building && !g.locked);
        if (gym) open({ kind: "gym", gym });
        else setToast(`${DOORS[Object.keys(DOORS).find((k) => DOORS[k].building === building) ?? ""]?.label ?? "This building"} has nothing in it yet.`);
      }),
      gameBus.on("locked", () => setToast("Locked. A manager unlocks this building by publishing a new content pack.")),
      gameBus.on("encounter:phish", async () => {
        try {
          const { card } = await getJson<{ card: PublicCard }>(`/api/encounter?learnerId=${learnerId}`);
          open({ kind: "wild", card });
        } catch {
          // No phishing cards: skip the encounter.
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [world, learnerId, open]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!ready) return null;
  if (!learnerId)
    return (
      <JoinForm
        onJoined={(id) => {
          store(id);
          setLearnerId(id);
        }}
      />
    );
  if (!world) return <p className="p-6">Loading the office…</p>;

  const badges = world.gyms.filter((g) => g.cleared).length;
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/" className="font-pixel text-xs">
            Orthogonal
          </Link>
          <p className="font-semibold">
            {world.learner.name} · {world.learner.role} · {world.company.name}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span aria-label={`${badges} badges`}>🏅 {badges}/{world.gyms.filter((g) => !g.locked).length}</span>
          <button
            onClick={() => {
              store(null);
              setLearnerId(null);
              setWorld(null);
            }}
            className="underline"
          >
            Switch hire
          </button>
        </div>
      </header>
      <p className="text-sm text-ink/70">Walk with the arrow keys or WASD (or the d-pad on a phone). Enter a building to battle. Watch out in the long grass.</p>
      <GameCanvas locked={world.locked} labels={Object.fromEntries(world.gyms.filter((g) => !g.locked).map((g) => [g.building, g.name]))} />
      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 mx-auto max-w-md rounded-lg bg-ink px-4 py-3 text-center text-paper shadow-lg">
          {toast}
        </div>
      )}
      {overlay && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/60 p-3" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl border-4 border-ink bg-paper p-5 shadow-2xl">
            {overlay.kind === "gym" && <GymOverlay gym={overlay.gym} learnerId={learnerId} onClose={close} />}
            {overlay.kind === "wild" && (
              <Battle title="A wild Phishmail appeared!" foeName="Phishmail" foeKind="wild" cards={[overlay.card]} learnerId={learnerId} onFinish={close} />
            )}
            {overlay.kind === "desk" && (
              <div className="flex flex-col gap-3">
                <Passport learnerId={learnerId} />
                <button onClick={close} className="self-end rounded bg-ink px-4 py-2 font-semibold text-paper">
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function JoinForm({ onJoined }: { onJoined: (learnerId: string) => void }) {
  const [joinCode, setJoinCode] = useState("ACME");
  const [name, setName] = useState("");
  const [role, setRole] = useState(ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="font-pixel text-xl leading-relaxed">Your first day</h1>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const { learner } = await postJson<{ learner: { id: string } }>("/api/learners", { joinCode, name, role });
            onJoined(learner.id);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Company code</span>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2 uppercase" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2" required maxLength={40} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Your role</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded border-2 border-ink/30 px-3 py-2">
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className="rounded bg-ink px-4 py-3 font-semibold text-paper disabled:opacity-50">
          {busy ? "Joining…" : "Start onboarding"}
        </button>
        {error && <p className="text-red-700">{error}</p>}
      </form>
    </main>
  );
}
