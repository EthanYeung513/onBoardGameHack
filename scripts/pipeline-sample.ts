// Drives one project through every pipeline stage without the web server, answering the two user
// gates automatically, and writes what each stage produced to artifacts/pipeline/<host>/.
import { mkdir, writeFile } from "node:fs/promises";
import { memory } from "@/lib/memory";
import { advance, ensureJob, releaseGate } from "@/lib/pipeline/runner";
import { ProjectModel } from "@/lib/schemas/project-model";
import { supabaseAdmin } from "@/lib/supabase/admin";

const url = process.argv[2] ?? "https://www.mubit.ai";
const email = process.argv[3] ?? "team@onboarding-studio.dev";

async function main() {
  const db = supabaseAdmin();
  const users = await db.auth.admin.listUsers();
  const user = users.data.users.find((u) => u.email === email);
  if (!user) throw new Error(`No user ${email}`);
  const resumeId = process.argv.includes("--resume") ? process.argv[process.argv.indexOf("--resume") + 1] : null;
  let id: string;
  if (resumeId) {
    id = resumeId;
  } else {
    const ins = await db.from("projects").insert({ url, created_by: user.id, status: "queued", stage: "crawl" }).select().single();
    if (ins.error) throw new Error(ins.error.message);
    id = ins.data.id as string;
    await ensureJob(db, id, "crawl");
  }
  console.log(`project ${id}`);
  let seen = resumeId ? Number.MAX_SAFE_INTEGER : 0;
  if (resumeId) {
    const last = await db.from("job_events").select("id").eq("project_id", id).order("id", { ascending: false }).limit(1).single();
    seen = last.data?.id ?? 0;
  }
  const t0 = Date.now();
  const printEvents = async () => {
    const { data } = await db.from("job_events").select("id, level, message").eq("project_id", id).gt("id", seen).order("id");
    for (const e of data ?? []) {
      console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s ${e.level.padEnd(5)} ${e.message}`);
      seen = e.id;
    }
  };
  for (let i = 0; i < 80; i++) {
    const r = await advance(id, { resume: i === 0 && Boolean(resumeId) });
    await printEvents();
    if (r.state === "ready" || r.state === "failed") break;
    if (r.state === "retry_scheduled") await new Promise((res) => setTimeout(res, r.retryInMs ?? 2000));
    if (r.state === "waiting" && r.stage === "awaiting_confirmation") {
      const m = await db.from("project_models").select("model_json").eq("project_id", id).order("version", { ascending: false }).limit(1).single();
      const model = ProjectModel.parse(m.data!.model_json);
      await db.from("project_models").insert({ project_id: id, version: 2, model_json: model, confirmed_at: new Date().toISOString() });
      await memory.rememberSiteFacts(id, "analyse", model.features.map((f) => ({ content: `Feature ${f.name}: ${f.description}`, sourceUrl: f.sourceUrls[0] })));
      await memory.rememberDecision(id, "review", { kind: "model_confirmed", what: "Confirmed the project model (version 2)", why: "Accepted as found by the sample script" });
      await releaseGate(id, "awaiting_confirmation");
    }
    if (r.state === "waiting" && r.stage === "awaiting_answers") {
      const qs = await db.from("questions").select("question_key, prompt, kind, options").eq("project_id", id).order("position");
      const rows = (qs.data ?? []).map((q) => ({ project_id: id, question_key: q.question_key, prompt: q.prompt, answer: q.kind === "multi" ? (q.options as string[]).slice(0, 2) : (q.options as string[])[0] ?? "" }));
      await db.from("answers").upsert(rows, { onConflict: "project_id,question_key" });
      for (const r2 of rows) await memory.rememberDecision(id, "questions", { kind: "answer", what: `${r2.prompt} Answer: ${JSON.stringify(r2.answer)}` });
      await releaseGate(id, "awaiting_answers");
    }
  }
  await printEvents();

  const host = new URL(url).hostname;
  const dir = `artifacts/pipeline/${host}`;
  await mkdir(dir, { recursive: true });
  const [model, tokens, questions, answers, flows, files, mem] = await Promise.all([
    db.from("project_models").select("version, model_json, confirmed_at").eq("project_id", id).order("version"),
    db.from("design_tokens").select("tokens_json, source").eq("project_id", id),
    db.from("questions").select("question_key, prompt, options").eq("project_id", id).order("position"),
    db.from("answers").select("question_key, answer").eq("project_id", id),
    db.from("flows").select("id, variant_key, version, status, spec_json").eq("project_id", id),
    db.from("generated_files").select("path, flow_id").eq("project_id", id),
    db.from("memory_events").select("operation, ok, payload_summary").eq("project_id", id).order("id"),
  ]);
  await writeFile(`${dir}/project-model.json`, JSON.stringify(model.data?.at(-1)?.model_json, null, 2));
  await writeFile(`${dir}/design-tokens.json`, JSON.stringify(tokens.data?.[0], null, 2));
  await writeFile(`${dir}/questions.json`, JSON.stringify({ questions: questions.data, answers: answers.data }, null, 2));
  for (const f of flows.data ?? []) await writeFile(`${dir}/flow-${f.variant_key}.json`, JSON.stringify(f.spec_json, null, 2));
  console.log(`\nflows: ${(flows.data ?? []).map((f) => `${f.variant_key}=${f.status}`).join(", ")}`);
  console.log(`generated files: ${files.data?.length}`);
  console.log(`memory events: ${(mem.data ?? []).map((m) => `${m.operation}${m.ok ? "" : "(failed)"}`).join(", ")}`);
  console.log(`total ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${dir}  project ${id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
