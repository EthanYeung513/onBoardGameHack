import type { MemoryClient } from "../brand/memory";
import { courseMemoryEnabled } from "./switch";

// Mubit memory for course-editing preferences: one global `course-preferences` agent, so what one
// company's manager keeps asking the assistant for informs the next company's first courses.
// Same switch as brand learning (MEMORY_PROVIDER=mubit + MUBIT_API_KEY); callers record
// "skipped" honestly when it is off and never block on it.

export const COURSE_AGENT = "course-preferences";
export const COURSE_SESSION = "course-preferences";

export interface CourseMemory {
  recall(query: string): Promise<string>;
  remember(d: { content: string; metadata: Record<string, string> }): Promise<void>;
  recordOutcome(o: { referenceId: string; success: boolean; summary: string; metadata: Record<string, string> }): Promise<void>;
}

export class MubitCourseMemory implements CourseMemory {
  constructor(private readonly client: () => Promise<MemoryClient>) {}

  async recall(query: string) {
    const res = await (await this.client()).recall({ session_id: COURSE_SESSION, agent_id: COURSE_AGENT, query });
    return String(res.final_answer ?? res.context ?? res.text ?? "").slice(0, 1500);
  }

  async remember(d: { content: string; metadata: Record<string, string> }) {
    await (await this.client()).remember({ session_id: COURSE_SESSION, agent_id: COURSE_AGENT, content: d.content, intent: "preference", metadata: d.metadata });
  }

  async recordOutcome(o: { referenceId: string; success: boolean; summary: string; metadata: Record<string, string> }) {
    await (await this.client()).recordOutcome({ session_id: COURSE_SESSION, agent_id: COURSE_AGENT, reference_id: o.referenceId, outcome: o.success ? "success" : "failure", summary: o.summary, metadata: o.metadata });
  }
}

/** Mubit memory when enabled, otherwise null. */
export function courseMemoryFromEnv(env: NodeJS.ProcessEnv = process.env): CourseMemory | null {
  if (!courseMemoryEnabled(env)) return null;
  let cached: MemoryClient | undefined;
  return new MubitCourseMemory(async () => {
    if (!cached) {
      const { Client } = await import("@mubit-ai/sdk");
      cached = new Client({ transport: "http", endpoint: env.MUBIT_ENDPOINT || "https://api.mubit.ai", run_id: COURSE_SESSION, api_key: env.MUBIT_API_KEY } as never) as unknown as MemoryClient;
    }
    return cached;
  });
}
