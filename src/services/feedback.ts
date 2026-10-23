import type { Scores } from "@/db/schema";
import type { MubitConfig } from "@/llm/mubit";
import { mubitConfigFromEnv } from "@/llm/env";

/** One human verdict on a grade, in the shape we send to Mubit. */
export interface FeedbackEvent {
  kind: "correction" | "approval";
  task: "grade";
  requestId: string | null;
  scenario: string;
  answer: string;
  original: Scores;
  corrected: Scores;
  reason: string;
  reviewer: string;
}

export interface FeedbackSink {
  readonly name: "mubit" | "distil";
  send(event: FeedbackEvent): Promise<{ delivered: boolean; detail: string }>;
}

/**
 * Sends corrections to Mubit's feedback endpoint. The payload shape is our best guess until Mubit confirms it at
 * kickoff (PLAN.md §15 Q1); only this class needs to change.
 */
export class MubitFeedbackSink implements FeedbackSink {
  readonly name = "mubit" as const;

  constructor(
    private readonly config: MubitConfig,
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(event: FeedbackEvent) {
    const url = /^https?:\/\//.test(this.url) ? this.url : `${this.config.baseURL.replace(/\/$/, "")}/${this.url.replace(/^\//, "")}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        request_id: event.requestId,
        task: event.task,
        verdict: event.kind === "approval" ? "approve" : "correct",
        corrected_output: { scores: event.corrected },
        reason: event.reason,
        reviewer: event.reviewer,
      }),
    });
    return { delivered: res.ok, detail: res.ok ? "sent to Mubit feedback endpoint" : `Mubit feedback returned ${res.status}` };
  }
}

/**
 * Fallback when Mubit has no feedback endpoint: the correction is stored and retrieved into future grading calls
 * (the fast path). Those calls produce corrected outputs, which Mubit keeps as examples for the next adapter.
 */
export class DistilSink implements FeedbackSink {
  readonly name = "distil" as const;
  async send() {
    return { delivered: false, detail: "stored for fast-path retrieval; distilled into kept examples by future calls" };
  }
}

export function getFeedbackSink(env: NodeJS.ProcessEnv = process.env): FeedbackSink {
  const config = mubitConfigFromEnv(env);
  return config && env.MUBIT_FEEDBACK_URL ? new MubitFeedbackSink(config, env.MUBIT_FEEDBACK_URL) : new DistilSink();
}
