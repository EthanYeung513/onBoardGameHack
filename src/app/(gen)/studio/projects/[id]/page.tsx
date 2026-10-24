import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/gen/shell/Header";
import { ProjectView } from "@/components/gen/project/ProjectView";
import { projectState } from "@/lib/pipeline/state";
import { currentUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/studio/projects/${id}`);
  const owner = await supabaseAdmin().from("projects").select("created_by").eq("id", id).maybeSingle();
  if (!owner.data || owner.data.created_by !== user.id) notFound();
  const state = await projectState(id);
  return (
    <>
      <Header email={user.email} crumbs={[{ href: "/studio", label: "Projects" }, { label: state.project.name ?? new URL(state.project.url).hostname }]} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <ProjectView initial={state} />
      </main>
    </>
  );
}
