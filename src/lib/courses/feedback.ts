import { mubitConfigFromEnv } from "../../llm/env";

// Feedback on one `course.assist` call, keyed by its Mubit request id (sibling of
// src/services/brand-feedback.ts). An edit the manager kept is an approval of the model's patches.
// With no MUBIT_FEEDBACK_URL the course_edits row itself is the evidence: it feeds the
// `course.preferences` distillation and every later generation.

export type CourseFeedback = { requestId: string | null; instruction: string; summary: string; accepted: boolean; packType: string; reviewer: string };

export function courseFeedbackPayload(e: CourseFeedback) {
  return {
    request_id: e.requestId,
    task: "course.assist",
    verdict: e.accepted ? "approve" : "reject",
    original_output: { summary: e.summary },
    reason: e.accepted ? `Manager kept the edit for "${e.instruction.slice(0, 200)}"` : `Manager undid the edit for "${e.instruction.slice(0, 200)}"`,
    reviewer: e.reviewer,
    metadata: { course: e.packType },
  };
}

export async function sendCourseFeedback(e: CourseFeedback, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch) {
  const config = mubitConfigFromEnv(env);
  if (!config || !env.MUBIT_FEEDBACK_URL) return { sink: "distil", delivered: false, detail: "no MUBIT_FEEDBACK_URL: kept as evidence for course.preferences" };
  if (!e.requestId) return { sink: "mubit", delivered: false, detail: "no Mubit request id (edit was made offline)" };
  const url = /^https?:\/\//.test(env.MUBIT_FEEDBACK_URL) ? env.MUBIT_FEEDBACK_URL : `${config.baseURL.replace(/\/$/, "")}/${env.MUBIT_FEEDBACK_URL.replace(/^\//, "")}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(courseFeedbackPayload(e)),
  });
  return { sink: "mubit", delivered: res.ok, detail: res.ok ? "sent to Mubit feedback endpoint" : `Mubit feedback returned ${res.status}` };
}
