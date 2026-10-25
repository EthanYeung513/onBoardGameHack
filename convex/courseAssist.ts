import type { FunctionReturnType } from "convex/server";
import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { mubitConfigFromEnv } from "../src/llm/env";
import { MubitClient } from "../src/llm/mubit";
import { AssistOutput, assistErrors, assistUserMessage, COURSE_ASSIST_TASK, offlineAssist } from "../src/lib/courses/assistant";
import { sendCourseFeedback } from "../src/lib/courses/feedback";
import { courseMemoryEnabled, recallQuery, withTimeout } from "../src/lib/courses/switch";
import { COURSE_PREFERENCES_TASK, offlinePreferences, preferenceErrors, preferencesUserMessage, PreferencesOutput, type Preference } from "../src/lib/courses/preferences";
import type { CoursePatch } from "../src/lib/flow/course-patch";
import { COURSE_ASSIST_SYSTEM_PROMPT, COURSE_PREFERENCES_SYSTEM_PROMPT } from "../src/lib/prompts";
import { fail } from "./lib/errors";

// Actions of course learning (convex/courseLearning.ts has the tables): the course-page
// assistant (`course.assist` through the Mubit gateway, src/llm/mubit.ts), the per-edit Mubit
// loop (feedback + memory + distil) and the hourly distillation cron. Default runtime so the
// panel answers without a Node cold start; only the Mubit memory SDK (gRPC) runs in Node
// (courseLearningNode.ts). Offline (no MUBIT_API_KEY) every step uses a labelled deterministic
// stand-in or records "skipped"; nothing is faked.

const msg = (err: unknown) => (err instanceof ConvexError ? String((err.data as { message?: string })?.message ?? err.data) : err instanceof Error ? err.message : String(err)).slice(0, 300);

type AssistContext = FunctionReturnType<typeof api.courseLearning.assistContext>;
type DistilContext = FunctionReturnType<typeof internal.courseLearning.distilContext>;
type AssistResult = { reply: string; applied: boolean; mode: "live" | "offline"; version?: number; requestId?: string | null };

/** The course page's assistant: instruction → validated CoursePatch[] → courses.applyPatch → evidence. */
export const assist = action({
  args: { courseId: v.id("courses"), version: v.number(), instruction: v.string() },
  handler: async (ctx, { courseId, version, instruction: raw }): Promise<AssistResult> => {
    const instruction = raw.trim().slice(0, 500);
    if (!instruction) return fail(422, "Ask for a change first");
    const c: AssistContext = await ctx.runQuery(api.courseLearning.assistContext, { courseId });
    if (c.version !== version) return fail(409, `This course changed since you opened it (now v${c.version}). Reload to edit.`);
    const approved = new Set(c.facts.map((f) => f.id));
    const config = mubitConfigFromEnv(process.env);
    let out: AssistOutput;
    let requestId: string | null = null;
    const mode = config ? "live" : "offline";
    if (!config) out = offlineAssist(c.spec, instruction);
    else {
      try {
        const r = await new MubitClient(config).json({
          task: COURSE_ASSIST_TASK,
          system: COURSE_ASSIST_SYSTEM_PROMPT,
          user: assistUserMessage({ course: c.spec, facts: c.facts, preferences: c.preferences, instruction }),
          schema: AssistOutput,
          validate: (o) => assistErrors(c.spec, approved, o),
          retries: 2,
        });
        out = r.value;
        requestId = r.requestId;
      } catch (err) {
        return { reply: `I couldn't turn that into a valid change to this course (${msg(err).slice(0, 160)}). Try rephrasing it.`, applied: false, mode };
      }
    }
    if (out.patches.length === 0) return { reply: out.reply, applied: false, mode, requestId };
    const patches = out.patches.map((p) => (p.value === undefined ? { op: p.op, path: p.path } : { op: p.op, path: p.path, value: p.value })) as CoursePatch[];
    let next: number;
    try {
      next = (await ctx.runMutation(api.courses.applyPatch, { courseId, version: c.version, patches })).version;
    } catch (err) {
      return { reply: `That change didn't go through: ${msg(err)}`, applied: false, mode, requestId };
    }
    await ctx.runMutation(internal.courseLearning.recordEdit, {
      courseId,
      userId: c.userId,
      instruction,
      reply: out.reply,
      patches,
      before: c.spec,
      fromVersion: c.version,
      mode,
      mubitRequestId: requestId ?? undefined,
    });
    return { reply: out.reply, applied: true, mode, version: next, requestId };
  },
});

/** Distil a space's recent edits into preferences (Mubit `course.preferences`, offline: heuristic). */
async function distil(ctx: ActionCtx, spaceId: Id<"spaces">, force = false): Promise<{ distilled: boolean }> {
  const d: DistilContext = await ctx.runQuery(internal.courseLearning.distilContext, { spaceId, force });
  if (!d) return { distilled: false };
  let recalled = "";
  if (courseMemoryEnabled(process.env)) {
    try {
      recalled = await withTimeout(ctx.runAction(internal.courseLearningNode.recall, { query: recallQuery({ name: d.company, host: d.host }) }), 8000, "Mubit memory recall");
    } catch {
      recalled = "";
    }
  }
  const config = mubitConfigFromEnv(process.env);
  const ids = new Set(d.edits.map((e) => e.id));
  let items: Preference[] = offlinePreferences(d.edits);
  let mode: "live" | "offline" = "offline";
  let requestId: string | null = null;
  if (config) {
    try {
      const r = await new MubitClient(config).json({
        task: COURSE_PREFERENCES_TASK,
        system: COURSE_PREFERENCES_SYSTEM_PROMPT,
        user: preferencesUserMessage({ company: d.company, edits: d.edits, current: d.current, recalled }),
        schema: PreferencesOutput,
        validate: (o) => preferenceErrors(o, ids),
        retries: 1,
      });
      items = r.value.preferences;
      mode = "live";
      requestId = r.requestId;
    } catch {
      // Keep the deterministic distillation (labelled offline) rather than nothing.
    }
  }
  await ctx.runMutation(internal.courseLearning.savePreferences, {
    spaceId,
    items: items.map((p) => ({ text: p.text, evidenceEditIds: p.evidence_edit_ids })),
    basedOnEdits: d.edits.length,
    lastEditAt: d.lastEditAt,
    mode,
    mubitRequestId: requestId ?? undefined,
    recalled: recalled || undefined,
  });
  return { distilled: true };
}

/** The Mubit loop for one assistant edit, scheduled by `recordEdit` so it never blocks the panel. */
export const loop = internalAction({
  args: { editId: v.id("course_edits") },
  handler: async (ctx, { editId }) => {
    const e = await ctx.runQuery(internal.courseLearning.loopContext, { editId });
    if (!e) return;
    let feedback: { sink: string; delivered: boolean; detail: string };
    try {
      feedback = await sendCourseFeedback({ requestId: e.mubitRequestId ?? null, instruction: e.instruction, summary: e.patchSummary, accepted: e.accepted, packType: e.packType, reviewer: e.actor });
    } catch (err) {
      feedback = { sink: "mubit", delivered: false, detail: `failed: ${msg(err)}` };
    }
    let mem: { status: "remembered" | "skipped" | "failed"; detail: string };
    if (!courseMemoryEnabled(process.env)) mem = { status: "skipped", detail: "Mubit memory not enabled (MEMORY_PROVIDER≠mubit or no key)" };
    else {
      try {
        mem = await withTimeout(
          ctx.runAction(internal.courseLearningNode.remember, {
            content: `A manager asked the course assistant: "${e.instruction}". It ${e.patchSummary}. Signals: ${e.signals.join("; ") || "none"}.`,
            metadata: { course: e.packType, signals: e.signals.join("; ").slice(0, 200) },
            referenceId: e.mubitRequestId ?? String(editId),
            success: e.accepted,
            summary: `course.assist edit kept: ${e.patchSummary.slice(0, 160)}`,
          }),
          20000,
          "Mubit memory",
        );
      } catch (err) {
        mem = { status: "failed", detail: msg(err) };
      }
    }
    await ctx.runMutation(internal.courseLearning.recordLoop, { editId, feedback, memory: mem });
    try {
      await distil(ctx, e.spaceId);
    } catch {
      // The hourly cron retries spaces whose preferences are older than their newest edit.
    }
  },
});

/** Hourly: re-distil every space with edits newer than its preferences. */
export const distilDue = internalAction({
  args: {},
  handler: async (ctx): Promise<{ due: number; distilled: number }> => {
    const due: Id<"spaces">[] = await ctx.runQuery(internal.courseLearning.spacesDue, {});
    let n = 0;
    for (const spaceId of due) {
      try {
        if ((await distil(ctx, spaceId)).distilled) n++;
      } catch {
        // Next run retries.
      }
    }
    return { due: due.length, distilled: n };
  },
});
