import { mubitConfigFromEnv } from "../llm/env";
import type { MubitConfig } from "../llm/mubit";

// Sibling of src/services/feedback.ts for brand decisions (S19, D-27). A manager's pick on the
// Design tab is a verdict on the `brand.recommend` call: approve when they kept the
// recommendation, correct (corrected_output = chosen) when they picked something else — keyed by
// the Mubit request id. Relative imports only: the Convex brand loop action bundles this file.

export interface BrandFeedbackEvent {
  kind: "approval" | "correction";
  task: "brand.recommend";
  requestId: string | null;
  field: string;
  recommended: string;
  chosen: string;
  host: string;
  category?: string;
  reviewer: string;
}

export function brandFeedbackPayload(e: BrandFeedbackEvent) {
  return {
    request_id: e.requestId,
    task: e.task,
    verdict: e.kind === "approval" ? "approve" : "correct",
    original_output: { [e.field]: { recommended: e.recommended } },
    corrected_output: { [e.field]: { recommended: e.chosen } },
    reason: e.kind === "approval" ? `Manager kept the recommended ${e.field}` : `Manager chose ${e.chosen} over ${e.recommended} for ${e.field}`,
    reviewer: e.reviewer,
    metadata: { field: e.field, host: e.host, ...(e.category ? { category: e.category } : {}) },
  };
}

export interface BrandFeedbackSink {
  readonly name: "mubit" | "distil";
  send(e: BrandFeedbackEvent): Promise<{ delivered: boolean; detail: string }>;
}

export class MubitBrandFeedbackSink implements BrandFeedbackSink {
  readonly name = "mubit" as const;
  constructor(
    private readonly config: MubitConfig,
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(e: BrandFeedbackEvent) {
    if (!e.requestId) return { delivered: false, detail: "no Mubit request id (recommendation was computed offline)" };
    const url = /^https?:\/\//.test(this.url) ? this.url : `${this.config.baseURL.replace(/\/$/, "")}/${this.url.replace(/^\//, "")}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(brandFeedbackPayload(e)),
    });
    return { delivered: res.ok, detail: res.ok ? "sent to Mubit feedback endpoint" : `Mubit feedback returned ${res.status}` };
  }
}

/**
 * No Mubit feedback endpoint configured (MUBIT_FEEDBACK_URL unset): the decision row is the
 * feedback — it is retrieved as a precedent into every future `brand.recommend` call (the fast
 * path), whose outputs Mubit keeps as examples for the task.
 */
export class DistilBrandSink implements BrandFeedbackSink {
  readonly name = "distil" as const;
  async send() {
    return { delivered: false, detail: "no MUBIT_FEEDBACK_URL: kept as a precedent for future brand.recommend calls" };
  }
}

export function getBrandFeedbackSink(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): BrandFeedbackSink {
  const config = mubitConfigFromEnv(env);
  return config && env.MUBIT_FEEDBACK_URL ? new MubitBrandFeedbackSink(config, env.MUBIT_FEEDBACK_URL, fetchImpl) : new DistilBrandSink();
}
