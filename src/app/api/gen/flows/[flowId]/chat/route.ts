import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { handle, HttpError, requireProject } from "@/lib/api/guard";
import { addStep, removeStep, reorderSteps, setThemeToken, setTransition, updateStep, type PatchResult } from "@/lib/flow/patch";
import { Step, type FlowSpec } from "@/lib/flow/spec";
import { latestFlow, saveVersion } from "@/lib/flow/versions";
import { chatModel, completeJson } from "@/lib/llm/client";
import { memory, safeMemory } from "@/lib/memory";
import { CHAT_SYSTEM_PROMPT } from "@/lib/prompts";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function POST(request: Request, ctx: { params: Promise<{ flowId: string }> }) {
  return handle(async () => {
    const { flowId } = await ctx.params;
    const start = await latestFlow(flowId);
    await requireProject(start.project_id);
    const projectId = start.project_id;
    const { messages }: { messages: UIMessage[] } = await request.json();
    if (!Array.isArray(messages) || messages.length === 0) throw new HttpError(400, "No message");
    const db = supabaseAdmin();

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
    await db.from("chat_messages").insert({ project_id: projectId, flow_id: start.id, role: "user", content: userText });

    const [model, ctxMem] = await Promise.all([
      db.from("project_models").select("model_json").eq("project_id", projectId).not("confirmed_at", "is", null).order("version", { ascending: false }).limit(1).single(),
      safeMemory.getProjectContext(projectId, "chat", userText, 1000),
    ]);

    // The working copy advances as tools apply changes within this turn.
    let current = start;
    const applied: Array<{ tool: string; summary: string; version?: number; errors?: string[] }> = [];
    async function apply(name: string, r: PatchResult) {
      if (!r.ok) {
        applied.push({ tool: name, summary: "rejected", errors: r.errors });
        return { ok: false, errors: r.errors };
      }
      const saved = await saveVersion({ flowId: current.id, spec: r.spec, action: `chat:${name}`, summary: r.summary });
      current = await latestFlow(saved.id);
      applied.push({ tool: name, summary: r.summary, version: saved.version });
      return { ok: true, summary: r.summary, version: saved.version };
    }
    const spec = () => current.spec_json as FlowSpec;

    const tools = {
      get_flow: tool({ description: "Read the current flow spec, including every step id.", inputSchema: z.object({}), execute: async () => ({ version: current.version, spec: spec() }) }),
      update_step: tool({
        description: "Change fields of one step (copy, options, points, showIf, transition). The step type cannot change.",
        inputSchema: z.object({ stepId: z.string(), changes: z.record(z.string(), z.unknown()) }),
        execute: async ({ stepId, changes }) => apply("update_step", updateStep(spec(), stepId, changes)),
      }),
      add_step: tool({
        description: "Insert a complete new step after the given step id (defaults to before the reward step).",
        inputSchema: z.object({ step: z.record(z.string(), z.unknown()), afterStepId: z.string().optional() }),
        execute: async ({ step, afterStepId }) => apply("add_step", addStep(spec(), step, afterStepId)),
      }),
      remove_step: tool({ description: "Remove a step by id.", inputSchema: z.object({ stepId: z.string() }), execute: async ({ stepId }) => apply("remove_step", removeStep(spec(), stepId)) }),
      reorder_steps: tool({
        description: "Reorder steps. Provide every step id exactly once.",
        inputSchema: z.object({ order: z.array(z.string()) }),
        execute: async ({ order }) => apply("reorder_steps", reorderSteps(spec(), order)),
      }),
      set_transition: tool({
        description: "Set the transition of a step: slide, fade, scale, stagger or morph.",
        inputSchema: z.object({ stepId: z.string(), transition: z.string() }),
        execute: async ({ stepId, transition }) => apply("set_transition", setTransition(spec(), stepId, transition)),
      }),
      set_theme_token: tool({
        description: "Override a theme colour for this flow. Tokens: primary, secondary, accent, background, surface, text, mutedText, border. Value is #rrggbb.",
        inputSchema: z.object({ token: z.string(), value: z.string() }),
        execute: async ({ token, value }) => apply("set_theme_token", setThemeToken(spec(), token, value)),
      }),
      regenerate_step: tool({
        description: "Rewrite one step from scratch following an instruction, keeping its id and type.",
        inputSchema: z.object({ stepId: z.string(), instruction: z.string() }),
        execute: async ({ stepId, instruction }) => {
          const old = spec().steps.find((s) => s.id === stepId);
          if (!old) return { ok: false, errors: [`No step with id "${stepId}"`] };
          const { data } = await completeJson(
            Step,
            {
              max_tokens: 3000,
              system: "You rewrite a single onboarding step as JSON for a fixed renderer. Keep the same id and type. Return only the step object.",
              messages: [{ role: "user", content: `Instruction: ${instruction}\n\nCurrent step:\n${JSON.stringify(old, null, 1)}\n\nCompany model:\n${JSON.stringify(model.data?.model_json ?? {}, null, 1)}` }],
            },
            { projectId, task: "regenerate_step", mode: "tool", validate: (s) => (s.id !== old.id || s.type !== old.type ? ["Keep the same id and type"] : []) },
          );
          return apply("regenerate_step", updateStep(spec(), stepId, data as Record<string, unknown>));
        },
      }),
    };

    const { model: llm, providerOptions } = await chatModel(projectId);
    const result = streamText({
      model: llm,
      system: CHAT_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `Context for this conversation (not a request).\nFlow variant: ${start.variant_key}, version ${start.version}.\nMemory of earlier decisions:\n${ctxMem?.text || "(none)"}\n\nCompany model:\n${JSON.stringify(model.data?.model_json ?? {}).slice(0, 6000)}` },
        { role: "assistant", content: "Understood." },
        ...(await convertToModelMessages(messages)),
      ],
      tools,
      stopWhen: stepCountIs(8),
      providerOptions,
      onFinish: async ({ text }) => {
        await db.from("chat_messages").insert({ project_id: projectId, flow_id: current.id, role: "assistant", content: text, tool_calls: applied });
        const ok = applied.filter((a) => a.version);
        if (ok.length) await memory.rememberDecision(projectId, "chat", { kind: "chat_change_accepted", what: `${start.variant_key}: ${ok.map((a) => a.summary).join("; ")}`, why: userText.slice(0, 300) }).catch(() => undefined);
      },
    });
    return result.toUIMessageStreamResponse();
  });
}
