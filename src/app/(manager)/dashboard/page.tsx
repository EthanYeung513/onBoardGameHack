"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { brandVars } from "@/components/manager/brand";
import { AiAssistant } from "@/components/manager/dashboard/AiAssistant";
import { AnalyticsTab } from "@/components/manager/dashboard/AnalyticsTab";
import { brandInfo } from "@/components/manager/dashboard/brandInfo";
import { CoursesTab } from "@/components/manager/dashboard/CoursesTab";
import { OverviewTab } from "@/components/manager/dashboard/OverviewTab";
import { RewardsTab } from "@/components/manager/dashboard/RewardsTab";
import { SettingsTab } from "@/components/manager/dashboard/SettingsTab";
import { TABS, type Space, type Tab } from "@/components/manager/dashboard/shared";
import { TeamTab } from "@/components/manager/dashboard/TeamTab";
import { ToolsTab } from "@/components/manager/dashboard/ToolsTab";
import { Icon } from "@/components/manager/icons";
import "./dashboard.css";

// dashboard.html, ported markup-for-markup: sidebar, `?tab=` sections, AI FAB and toast. The
// mockup's localStorage state is replaced by the Convex queries each tab subscribes to.

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: "overview", label: "Dashboard", icon: "grid" },
  { tab: "courses", label: "Courses", icon: "book" },
  { tab: "tools", label: "Tools", icon: "layers" },
  { tab: "team", label: "Team", icon: "users" },
  { tab: "analytics", label: "Analytics", icon: "chart" },
  { tab: "rewards", label: "Rewards", icon: "gift" },
  { tab: "settings", label: "Settings", icon: "sliders" },
];

function useToast() {
  const [text, setText] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((t: string) => {
    setText(t);
    setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 2600);
  }, []);
  return { toast, text, show };
}

function DashboardView({ space, managerName }: { space: Space; managerName: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const initial = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : "overview");
  const { toast, text, show } = useToast();
  const B = brandInfo(space);
  const props = { space, toast };

  const go = (t: Tab) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  };

  return (
    <div style={brandVars(space.brand)}>
      <div className="dash">
        <aside className="side">
          <div className="logo">
            <span className="mk" id="logo-mk" style={{ background: "var(--brand)" }}>
              {B.initials}
            </span>
            <span id="brand-name">{B.company}</span>
          </div>
          <div className="spacename" id="space-sub">
            Space · {B.host}
          </div>
          {NAV.map((n) => (
            <a
              key={n.tab}
              href={`?tab=${n.tab}`}
              data-tab={n.tab}
              data-tip={n.label}
              className={tab === n.tab ? "on" : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(n.tab);
              }}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </a>
          ))}
          <div className="grow" />
          <a
            href="/"
            data-tip="Sign out"
            onClick={(e) => {
              e.preventDefault();
              void signOut().then(() => router.push("/"));
            }}
          >
            <Icon name="logout" />
            <span>Sign out</span>
          </a>
          <div className="who" id="who">
            {managerName} · {B.host}
          </div>
        </aside>

        <main className="main">
          <section id="tab-overview" hidden={tab !== "overview"}>
            <OverviewTab {...props} managerName={managerName} brandPill={B.style ? `${B.style} · ${B.host}` : B.host} />
          </section>
          <section id="tab-courses" hidden={tab !== "courses"}>
            <CoursesTab {...props} />
          </section>
          <section id="tab-tools" hidden={tab !== "tools"}>
            <ToolsTab {...props} />
          </section>
          <section id="tab-team" hidden={tab !== "team"}>
            <TeamTab {...props} />
          </section>
          <section id="tab-analytics" hidden={tab !== "analytics"}>
            {tab === "analytics" && <AnalyticsTab {...props} />}
          </section>
          <section id="tab-rewards" hidden={tab !== "rewards"}>
            <RewardsTab {...props} />
          </section>
          <section id="tab-settings" hidden={tab !== "settings"}>
            <SettingsTab {...props} B={B} managerName={managerName} />
          </section>
        </main>
      </div>

      <AiAssistant spaceId={space._id} />
      <div className={`toast${show ? " show" : ""}`} id="toast" role="status">
        {text}
      </div>
    </div>
  );
}

function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  const spaces = useQuery(api.spaces.mine, isAuthenticated ? {} : "skip");
  const viewer = useQuery(api.users.viewer);
  const params = useSearchParams();
  const router = useRouter();
  const wanted = params.get("space") as Id<"spaces"> | null;
  const managed = spaces?.filter((s) => s.role !== "hire");
  const pick = managed?.find((s) => s._id === wanted) ?? managed?.[0];
  const space = useQuery(api.spaces.get, pick ? { spaceId: pick._id } : "skip");

  // Mockup: no space yet → space.html.
  useEffect(() => {
    if (managed && managed.length === 0) router.replace("/space/new");
  }, [managed, router]);

  if (!space) return null;
  return <DashboardView space={space} managerName={viewer?.name ?? ""} />;
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
