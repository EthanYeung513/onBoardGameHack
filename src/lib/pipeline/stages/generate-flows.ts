import { completeJson } from "@/lib/llm/client";
import { safeMemory } from "@/lib/memory";
import { FlowSpec, flowSpecJsonSchema, semanticErrors } from "@/lib/flow/spec";
import { VARIANTS } from "@/lib/flow/variants";
import { FLOW_SYSTEM_PROMPT } from "@/lib/prompts";
import { ANSWER_DEFAULTS } from "@/lib/questions/bank";
import type { StageContext, StageDefinition } from "../types";

// One variant per slice so each invocation stays well inside the function time limit.

export async function generationInputs(ctx: Pick<StageContext, "db" | "project">) {
  const { db, project } = ctx;
  const [model, tokens, answers] = await Promise.all([
    db.from("project_models").select("model_json").eq("project_id", project.id).not("confirmed_at", "is", null).order("version", { ascending: false }).limit(1).single(),
    db.from("design_tokens").select("tokens_json").eq("project_id", project.id).order("version", { ascending: false }).limit(1).single(),
    db.from("answers").select("question_key, prompt, answer").eq("project_id", project.id),
  ]);
  if (model.error) throw new Error(`No confirmed project model: ${model.error.message}`);
  if (tokens.error) throw new Error(`No design tokens: ${tokens.error.message}`);
  const given = Object.fromEntries((answers.data ?? []).map((a) => [a.question_key, a.answer]));
  return { model: model.data.model_json, tokens: tokens.data.tokens_json, answers: { ...ANSWER_DEFAULTS, ...given }, answerRows: answers.data ?? [] };
}

export const generateFlowsStage: StageDefinition = {
  name: "generate_flows",
  label: "Generate flows",
  description: "Design three gamified onboarding variants",
  maxAttempts: 3,
  async run(ctx) {
    const { db, project } = ctx;
    const have = await db.from("flows").select("variant_key").eq("project_id", project.id);
    const done = new Set((have.data ?? []).map((f) => f.variant_key));
    const todo = VARIANTS.filter((v) => !done.has(v.key));
    if (todo.length === 0) return { done: true, summary: `${VARIANTS.length} variants` };
    const variant = todo[0];

    const inputs = await generationInputs(ctx);
    const memory = await safeMemory.getProjectContext(project.id, "generate_flows", `onboarding flow ${variant.key} tone palette transitions decisions`, 1200);
    await ctx.event("info", `Designing the ${variant.key} variant`, { memoryItems: memory?.items.length ?? 0 });

    const answersText = inputs.answerRows.length
      ? inputs.answerRows.map((a) => `- ${a.prompt}: ${JSON.stringify(a.answer)}`).join("\n")
      : Object.entries(inputs.answers).map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n");
    const maxSteps = Math.max(4, Math.min(12, parseInt(String(inputs.answers.max_steps), 10) || 8));

    const { data, route, attempts } = await completeJson(
      FlowSpec,
      {
        max_tokens: 12000,
        system: FLOW_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Variant key: ${variant.key}\nGamification style: ${variant.style}\nVariant brief: ${variant.brief}\nMaximum steps: ${maxSteps}\n\nAnswers from the team:\n${answersText}\n\nMemory of earlier decisions and lessons:\n${memory?.text || "(none yet)"}\n\nConfirmed project model:\n${JSON.stringify(inputs.model, null, 1)}\n\nDesign tokens:\n${JSON.stringify(inputs.tokens, null, 1)}`,
          },
        ],
      },
      {
        projectId: project.id,
        task: "generate_flow",
        mode: "prompted",
        jsonSchema: flowSpecJsonSchema,
        log: (l, m, d) => ctx.event(l, m, d),
        validate: (spec) => {
          const errs = semanticErrors(spec);
          if (spec.variantKey !== variant.key) errs.push(`variantKey: must be "${variant.key}"`);
          if (spec.gamification.style !== variant.style) errs.push(`gamification.style: must be "${variant.style}"`);
          if (spec.steps.length > maxSteps) errs.push(`steps: at most ${maxSteps} steps were requested, got ${spec.steps.length}`);
          return errs;
        },
      },
    ).catch(async (err) => {
      // Only failed validation teaches the generator anything; transport errors are not lessons.
      if (!String((err as Error).message).startsWith("Output failed validation")) throw err;
      await safeMemory.recordOutcome(project.id, "generate_flows", { kind: "validation_failed", detail: `${variant.key} variant: ${(err as Error).message.slice(0, 300)}`, success: false });
      throw err;
    });
    if (attempts > 1) await safeMemory.recordOutcome(project.id, "generate_flows", { kind: "validation_failed", detail: `${variant.key} variant needed ${attempts} attempts before it validated`, success: false });

    const ins = await db.from("flows").insert({ project_id: project.id, variant_key: variant.key, version: 1, spec_json: data, status: "draft", created_by_action: "generate" });
    if (ins.error && !ins.error.message.includes("duplicate")) throw new Error(ins.error.message);
    await ctx.event("info", `${variant.key} variant designed: ${data.steps.length} steps, ${data.gamification.mechanics.badges.length} badges (${route})`);
    const remaining = todo.length - 1;
    if (remaining === 0) return { done: true, summary: `${VARIANTS.length} variants` };
    return { done: false, cursor: { generated: VARIANTS.length - remaining }, progress: (VARIANTS.length - remaining) / VARIANTS.length };
  },
};
