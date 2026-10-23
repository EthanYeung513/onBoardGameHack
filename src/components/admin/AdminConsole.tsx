"use client";

import Link from "next/link";
import { useState } from "react";
import { ContentPanel } from "./ContentPanel";
import { LearningTimeline } from "./LearningTimeline";
import { ReadinessPanel } from "./ReadinessPanel";
import { ReviewQueue } from "./ReviewQueue";

const tabs = ["Review queue", "Learning timeline", "Readiness", "Content"] as const;
type Tab = (typeof tabs)[number];

export function AdminConsole() {
  const [tab, setTab] = useState<Tab>("Review queue");
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="font-pixel text-sm">
            GymQuest
          </Link>
          <h1 className="text-2xl font-bold">Manager console · Acme Pay</h1>
        </div>
        <nav className="flex flex-wrap gap-1" aria-label="Console sections">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={t === tab ? "page" : undefined}
              className={`rounded px-3 py-1.5 font-semibold ${t === tab ? "bg-ink text-paper" : "hover:bg-ink/10"}`}
            >
              {t}
            </button>
          ))}
        </nav>
      </header>
      {tab === "Review queue" && <ReviewQueue />}
      {tab === "Learning timeline" && <LearningTimeline />}
      {tab === "Readiness" && <ReadinessPanel />}
      {tab === "Content" && <ContentPanel />}
    </main>
  );
}
