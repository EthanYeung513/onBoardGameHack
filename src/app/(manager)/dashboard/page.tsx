"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Logo } from "@/components/manager/Logo";

// Wave-1 shell: proves auth + spaces end to end. S13 replaces this with the mockup's tabbed dashboard.
function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  const spaces = useQuery(api.spaces.mine, isAuthenticated ? {} : "skip");
  const viewer = useQuery(api.users.viewer);
  const params = useSearchParams();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const wanted = params.get("space") as Id<"spaces"> | null;
  const space = spaces?.find((s) => s._id === wanted) ?? spaces?.[0];

  useEffect(() => {
    if (spaces && spaces.length === 0) router.replace("/space/new");
  }, [spaces, router]);

  if (!space) return <p style={{ padding: 40 }}>Loading…</p>;
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
        <Logo />
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>{viewer?.email}</span>
          <button className="btn btn-ghost" onClick={() => void signOut().then(() => router.push("/"))}>
            Logout
          </button>
        </div>
      </header>
      <h1 style={{ fontSize: 40, letterSpacing: "-0.03em", fontWeight: 500 }}>{space.name}</h1>
      <p style={{ color: "var(--muted)", margin: "6px 0 24px" }}>
        {space.host} · {space.role} · status <strong>{space.status}</strong>
      </p>
      {spaces && spaces.length > 1 && (
        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {spaces.map((s) => (
            <Link key={s._id} className="btn btn-ghost" href={`/dashboard?space=${s._id}`}>
              {s.name}
            </Link>
          ))}
        </nav>
      )}
      <p style={{ marginTop: 24 }}>
        <Link className="btn btn-primary" href="/space/new">
          + New space
        </Link>
      </p>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
