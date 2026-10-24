import { after } from "next/server";
import { pipelineSecret } from "./runner";

/**
 * Asks the pipeline endpoint to run the next slice in a fresh invocation. The endpoint answers
 * immediately and does its work after responding, so chained slices never stack up.
 */
export function kick(origin: string, projectId: string, delayMs = 0) {
  after(async () => {
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    try {
      await fetch(`${origin}/api/gen/pipeline/${projectId}/advance`, {
        method: "POST",
        headers: { "x-pipeline-secret": pipelineSecret() },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error("pipeline kick failed", err);
    }
  });
}

export function originOf(request: Request): string {
  const env = process.env.APP_URL;
  if (env) return env.replace(/\/$/, "");
  return new URL(request.url).origin;
}
