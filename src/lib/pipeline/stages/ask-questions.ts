import { completeJson } from "@/lib/llm/client";
import { QUESTIONS_SYSTEM_PROMPT } from "@/lib/prompts";
import { ChosenQuestions, checkChosen, QUESTION_BANK } from "@/lib/questions/bank";
import type { StageDefinition } from "../types";

export const askQuestionsStage: StageDefinition = {
  name: "ask_questions",
  label: "Prepare questions",
  description: "Choose and phrase clarifying questions for this company",
  maxAttempts: 3,
  async run(ctx) {
    const { db, project } = ctx;
    const existing = await db.from("questions").select("id").eq("project_id", project.id).limit(1);
    if (existing.data?.length) return { done: true, summary: "questions already prepared" };
    const model = await db.from("project_models").select("model_json").eq("project_id", project.id).not("confirmed_at", "is", null).order("version", { ascending: false }).limit(1).single();
    if (model.error) throw new Error(`No confirmed project model: ${model.error.message}`);

    const bank = Object.entries(QUESTION_BANK).map(([key, v]) => `- ${key} (${v.kind}): ${v.intent}`).join("\n");
    const { data } = await completeJson(
      ChosenQuestions,
      {
        max_tokens: 3000,
        system: QUESTIONS_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Question bank:\n${bank}\n\nConfirmed project model:\n${JSON.stringify(model.data.model_json, null, 1)}` }],
      },
      { projectId: project.id, task: "ask_questions", log: (l, m, d) => ctx.event(l, m, d), validate: checkChosen },
    );
    const rows = data.questions.map((q, i) => ({ project_id: project.id, question_key: q.key, prompt: q.prompt, kind: QUESTION_BANK[q.key].kind, options: q.options, position: i }));
    const up = await db.from("questions").upsert(rows, { onConflict: "project_id,question_key" });
    if (up.error) throw new Error(up.error.message);
    return { done: true, summary: `${rows.length} questions: ${rows.map((r) => r.question_key).join(", ")}` };
  },
};
