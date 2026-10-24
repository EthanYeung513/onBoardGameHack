import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedScreenshotUrl } from "./media";
import { watchdog } from "./runner";

/** Everything the project page needs in one read. Runs the watchdog first. */
export async function projectState(projectId: string) {
  const db = supabaseAdmin();
  await watchdog(db, projectId);
  const [project, jobs, events, pages, assets, models, tokens, questions, answers, flows] = await Promise.all([
    db.from("projects").select().eq("id", projectId).single(),
    db.from("jobs").select().eq("project_id", projectId),
    db.from("job_events").select().eq("project_id", projectId).order("id", { ascending: false }).limit(200),
    db.from("crawl_pages").select("id, url, title, page_type, word_count, fetch_method, status, error, fetched_at").eq("project_id", projectId).order("rank_score", { ascending: false }),
    db.from("assets").select().eq("project_id", projectId),
    db.from("project_models").select().eq("project_id", projectId).order("version", { ascending: false }).limit(1),
    db.from("design_tokens").select().eq("project_id", projectId).order("version", { ascending: false }).limit(1),
    db.from("questions").select().eq("project_id", projectId).order("position"),
    db.from("answers").select().eq("project_id", projectId),
    db.from("flows").select("id, variant_key, version, spec_json, status, created_by_action, created_at, parent_id").eq("project_id", projectId).order("version", { ascending: false }),
  ]);
  if (project.error) throw new Error(project.error.message);
  const screenshots = await Promise.all(
    (assets.data ?? [])
      .filter((a) => a.kind === "screenshot" && a.storage_path)
      .map(async (a) => ({ ...a, signedUrl: await signedScreenshotUrl(db, a.storage_path) })),
  );
  const latestFlows = new Map<string, (typeof flows.data & object)[number]>();
  for (const f of flows.data ?? []) if (!latestFlows.has(f.variant_key)) latestFlows.set(f.variant_key, f);
  return {
    project: project.data,
    jobs: jobs.data ?? [],
    events: (events.data ?? []).reverse(),
    pages: pages.data ?? [],
    assets: (assets.data ?? []).filter((a) => a.kind !== "screenshot"),
    screenshots,
    model: models.data?.[0] ?? null,
    tokens: tokens.data?.[0] ?? null,
    questions: questions.data ?? [],
    answers: answers.data ?? [],
    flows: [...latestFlows.values()],
  };
}
export type ProjectState = Awaited<ReturnType<typeof projectState>>;
