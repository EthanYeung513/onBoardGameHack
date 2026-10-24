import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/gen/shell/Header";
import { NewProjectForm } from "@/components/gen/studio/NewProjectForm";
import { STAGE_LABELS } from "@/lib/pipeline/labels";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATUS_TEXT: Record<string, string> = {
  queued: "Queued",
  running: "Working",
  waiting: "Needs you",
  failed: "Failed",
  stalled: "Stalled",
  ready: "Ready",
};

export default async function StudioPage() {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/login");
  const { data: projects } = await sb.from("projects").select("id, url, name, status, stage, created_at").order("created_at", { ascending: false }).limit(50);

  return (
    <>
      <Header email={auth.user.email} />
      <main className="mx-auto max-w-6xl space-y-10 px-6 py-10">
        <section className="max-w-3xl space-y-4">
          <h1 className="text-3xl font-bold">Start from a website</h1>
          <p className="g-muted">We crawl up to 30 pages, read the brand, and show you what we found before anything is generated.</p>
          <NewProjectForm />
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-bold">Projects</h2>
          {!projects?.length ? (
            <p className="g-muted">No projects yet. Paste a website above to make the first one.</p>
          ) : (
            <ul className="g-panel divide-y" style={{ borderColor: "var(--g-line)" }}>
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/studio/projects/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-[var(--g-canvas)]" data-testid="project-row">
                    <span className="font-semibold">{p.name ?? new URL(p.url).hostname}</span>
                    <span className="g-muted truncate text-sm">{p.url}</span>
                    <span className="ml-auto text-sm">
                      {STAGE_LABELS.find((s) => s.key === p.stage)?.label}, {STATUS_TEXT[p.status] ?? p.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
