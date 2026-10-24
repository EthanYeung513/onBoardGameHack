import { normaliseUrl } from "@/lib/crawl/rank";
import { DesignTokens } from "@/lib/schemas/tokens";
import { ProjectModel } from "@/lib/schemas/project-model";
import { validateFlowSpec, type FlowSpec } from "@/lib/flow/spec";
import { saveVersion } from "@/lib/flow/versions";
import { memory, safeMemory } from "@/lib/memory";
import { assetsOf, brandOf, connectorsOf, friendlyLog, fromSteps, levelsOf, paletteOf, scanFindings, skeletonOf, toSteps, typographyOf } from "@/lib/orthogonal/mapping";
import type { BuildRequest, BuildLogEntry, Project, PublishResult, ScanResult, ShipRequest } from "@/lib/orthogonal/types";
import { ensureJob, skipStages } from "@/lib/pipeline/runner";
import { projectState } from "@/lib/pipeline/state";
import { STAGES } from "@/lib/pipeline/types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { BadRequestError, NotFoundError } from "@/services/errors";

// The constructor UI's backend, built on the generator pipeline. Scans and builds start pipeline
// work and return at once; the UI polls the GET endpoints until status is "ready".

const CACHE_HOURS = 24;

const siteUrlOf = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const nameOf = (p: { name: string | null; url: string }) => p.name ?? new URL(p.url).hostname.replace(/^www\./, "").split(".")[0];

async function owned(projectId: string, userId: string) {
  const { data } = await supabaseAdmin().from("projects").select("id, created_by, url").eq("id", projectId).maybeSingle();
  if (!data || data.created_by !== userId) throw new NotFoundError("Project not found");
  return data;
}

/** Starts a scan, reusing this user's analysis or crawl of the same site from the last day. */
export async function startScan(userId: string, input: string): Promise<{ id: string }> {
  const raw = input.trim();
  const url = normaliseUrl(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!url || !raw) throw new BadRequestError("Enter a website address");
  const db = supabaseAdmin();
  const since = new Date(Date.now() - CACHE_HOURS * 3600_000).toISOString();
  const recent = await db.from("projects").select("id, stage").eq("created_by", userId).eq("url", url).gte("created_at", since).order("created_at", { ascending: false }).limit(5);
  // A recent project still waiting for review can be picked up as is.
  const waiting = (recent.data ?? []).find((p) => p.stage === "awaiting_confirmation");
  if (waiting) return { id: waiting.id };
  const cached = await db
    .from("projects")
    .select("id, reused_crawl_from, jobs!inner(stage, status)")
    .eq("created_by", userId)
    .eq("url", url)
    .eq("jobs.stage", "crawl")
    .eq("jobs.status", "succeeded")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  const source = cached.data?.[0];
  const ins = await db.from("projects").insert({ url, created_by: userId, status: "queued", stage: "crawl", reused_crawl_from: source ? (source.reused_crawl_from ?? source.id) : null }).select("id").single();
  if (ins.error) throw new Error(ins.error.message);
  await ensureJob(db, ins.data.id, "crawl");
  return { id: ins.data.id };
}

export async function scanView(userId: string, projectId: string): Promise<ScanResult> {
  await owned(projectId, userId);
  const s = await projectState(projectId);
  const job = s.jobs.find((j) => j.stage === s.project.stage);
  const idx = STAGES.indexOf(s.project.stage);
  const ready = idx >= STAGES.indexOf("awaiting_confirmation") && Boolean(s.model);
  const failed = job?.status === "failed";
  const progress = ready ? 1 : s.project.stage === "crawl" ? 0.05 + 0.5 * (job?.progress ?? 0) : s.project.stage === "extract_design" ? 0.6 : 0.8;
  const pages = s.pages.filter((p) => p.status === "fetched");
  const tokens = s.tokens ? DesignTokens.parse(s.tokens.tokens_json) : null;
  const model = s.model ? ProjectModel.parse(s.model.model_json) : null;
  const siteUrl = siteUrlOf(s.project.url);
  const siteName = model?.companyName ?? nameOf(s.project);
  const log = friendlyLog(s.events.filter((e) => e.level !== "debug").map((e) => e.message));
  const base = {
    id: s.project.id,
    siteUrl,
    siteName,
    log: log.length ? log : [`Resolving ${siteUrl}`],
    status: ready ? ("ready" as const) : failed || job?.status === "stalled" ? ("failed" as const) : ("running" as const),
    progress,
    error: failed || job?.status === "stalled" ? (job?.error ?? "The scan stopped") : undefined,
    studioUrl: `/studio/projects/${s.project.id}`,
  };
  if (!tokens || !model) {
    return { ...base, skeleton: tokens ? skeletonOf(siteName, pages.map((p) => p.page_type ?? "other"), tokens, pages[0]?.title ?? siteName) : [], category: "", confidence: "low", pageCount: pages.length, summary: "", tone: "", palette: tokens ? paletteOf(tokens) : [], typography: tokens ? typographyOf(tokens) : { heading: { family: "", weight: 600 }, body: { family: "", weight: 400 }, notes: "" }, features: [], ideas: [], structure: { outline: [], duration: "" } };
  }
  return {
    ...base,
    skeleton: skeletonOf(siteName, pages.map((p) => p.page_type ?? "other"), tokens, model.valuePropositions[0] ?? siteName),
    palette: paletteOf(tokens),
    typography: typographyOf(tokens),
    ...scanFindings(model, pages),
  };
}

/** Confirms the findings, records the description and repo, and starts generating flows. */
export async function startBuild(userId: string, req: BuildRequest): Promise<{ id: string }> {
  const projectId = req.scanId;
  await owned(projectId, userId);
  const db = supabaseAdmin();
  const p = await db.from("projects").select("stage").eq("id", projectId).single();
  if (p.data?.stage !== "awaiting_confirmation") return { id: projectId };

  const last = await db.from("project_models").select("version, model_json").eq("project_id", projectId).order("version", { ascending: false }).limit(1).single();
  if (last.error) throw new BadRequestError("The scan has not finished yet");
  const model = ProjectModel.parse(last.data.model_json);
  await db.from("project_models").insert({ project_id: projectId, version: last.data.version + 1, model_json: model, confirmed_at: new Date().toISOString() });
  const answers: Array<{ project_id: string; question_key: string; prompt: string; answer: string }> = [];
  if (req.description) answers.push({ project_id: projectId, question_key: "team_notes", prompt: "Anything the team added about who signs up and what they need first", answer: req.description });
  if (req.repo) answers.push({ project_id: projectId, question_key: "github_repo", prompt: "Repository the onboarding should land in", answer: req.repo });
  if (answers.length) await db.from("answers").upsert(answers, { onConflict: "project_id,question_key" });
  await Promise.allSettled([
    memory.rememberSiteFacts(projectId, "analyse", [
      { content: `${model.companyName}: ${model.productSummary}` },
      { content: `Tone of voice: ${model.toneOfVoice.adjectives.join(", ")}` },
      ...model.features.map((f) => ({ content: `Feature ${f.name}: ${f.description}`, sourceUrl: f.sourceUrls[0] })),
    ]),
    memory.rememberDecision(projectId, "constructor", { kind: "model_confirmed", what: "Findings accepted in the constructor", why: req.description ? `Team notes: ${req.description}` : "Accepted as found" }),
  ]);
  await skipStages(projectId, ["awaiting_confirmation", "ask_questions", "awaiting_answers"], "generate_flows", "answered in the constructor");
  return { id: projectId };
}

export async function projectView(userId: string, projectId: string): Promise<Project> {
  await owned(projectId, userId);
  const s = await projectState(projectId);
  const tokens = s.tokens ? DesignTokens.parse(s.tokens.tokens_json) : null;
  const model = s.model ? ProjectModel.parse(s.model.model_json) : null;
  if (!tokens || !model) throw new BadRequestError("The scan has not finished yet");
  const quest = s.flows.find((f) => f.variant_key === "quest");
  const spec = quest ? (quest.spec_json as FlowSpec) : null;
  const steps = spec ? toSteps(spec, tokens, model) : [];
  const repo = (s.answers.find((a) => a.question_key === "github_repo")?.answer as string | undefined) ?? null;
  const genStart = s.events.findIndex((e) => /^Generate flows started|skipped: answered in the constructor/.test(e.message));
  const log: BuildLogEntry[] = friendlyLog(s.events.slice(Math.max(0, genStart)).map((e) => e.message))
    .filter((m) => !/skipped: answered/.test(m))
    .map((text) => ({ text }));
  if (log.length === 0) log.push({ text: `Reading extraction · ${model.features.length} features, ${paletteOf(tokens).length} colours, 2 fonts` });
  steps.forEach((st, i) => log.push({ text: `Step ${i + 1} · ${st.title}`, step: i + 1 }));
  const job = s.jobs.find((j) => j.stage === s.project.stage);
  const failed = job?.status === "failed" || job?.status === "stalled";
  return {
    id: s.project.id,
    siteUrl: siteUrlOf(s.project.url),
    siteName: model.companyName,
    repo,
    brand: brandOf(tokens),
    palette: paletteOf(tokens),
    typography: typographyOf(tokens),
    log,
    steps,
    levels: spec ? levelsOf(spec, steps) : [{ at: 0, level: 1, name: "Newcomer" }],
    assets: assetsOf(model, tokens, steps, s.screenshots),
    connectors: connectorsOf(repo !== null),
    status: steps.length ? "ready" : failed ? "failed" : "building",
    error: failed ? (job?.error ?? "The build stopped") : undefined,
    studioUrl: `/studio/projects/${s.project.id}`,
  };
}

/** Saves the constructor's edits as a new published version and returns its public page. */
export async function publishLive(userId: string, projectId: string, req: ShipRequest, origin: string): Promise<PublishResult> {
  await owned(projectId, userId);
  const db = supabaseAdmin();
  const latest = await db.from("flows").select("id, spec_json").eq("project_id", projectId).eq("variant_key", "quest").order("version", { ascending: false }).limit(1).single();
  if (latest.error) throw new BadRequestError("There is no flow to publish yet");
  const spec = fromSteps(req.steps, latest.data.spec_json as FlowSpec);
  const v = validateFlowSpec(spec);
  if (!v.ok) throw new BadRequestError(`This flow cannot be published yet: ${v.errors[0]}`);
  const saved = await saveVersion({ flowId: latest.data.id, spec: v.spec, action: "publish", summary: "Published from the constructor" });
  await db.from("flows").update({ status: "published" }).eq("id", saved.id);
  await safeMemory.recordOutcome(projectId, "constructor", { kind: "flow_published", detail: `quest flow version ${saved.version} published with ${v.spec.steps.length} steps`, success: true });
  const host = `${origin.replace(/^https?:\/\//, "")}/f/${saved.id}`;
  return { host, via: "orthogonal", storage: req.connectors.supabase ? "supabase" : null };
}
