import { api } from "@convex/_generated/api";
import type { StageContext } from "@/worker/types";
import { courseMemoryFromEnv, type CourseMemory } from "./memory";
import { recallQuery, withTimeout } from "./switch";

// generate_courses hook: what Mubit learned about how this manager (and managers at similar
// companies) edit courses, as `manager_preferences` for the course user message. Read once per
// job; a slow or failing memory recall never blocks generation.

const cache = new Map<string, Promise<string[]>>();

export async function learnedPreferences(ctx: Pick<StageContext, "convex" | "space" | "job">, memory: CourseMemory | null = courseMemoryFromEnv()): Promise<string[]> {
  const stored = await ctx.convex.query(api.courseLearning.forGeneration, { spaceId: ctx.space._id });
  const out = [...stored.preferences];
  if (memory) {
    try {
      const recalled = (await withTimeout(memory.recall(recallQuery({ name: stored.company, host: stored.host })), 4000, "Mubit memory recall")).trim();
      if (recalled) out.push(`From similar companies (Mubit memory): ${recalled.slice(0, 400)}`);
    } catch {
      // Generation goes on with this space's own preferences.
    }
  }
  return out;
}

/** `{ manager_preferences }` to spread into the generation user message, or nothing when none were learned. */
export async function managerPreferences(ctx: Pick<StageContext, "convex" | "space" | "job">): Promise<{ manager_preferences?: string[] }> {
  const key = String(ctx.job._id);
  if (!cache.has(key)) {
    cache.set(key, learnedPreferences(ctx).catch(() => []));
    if (cache.size > 50) cache.delete(cache.keys().next().value as string);
  }
  const prefs = await cache.get(key)!;
  return prefs.length ? { manager_preferences: prefs } : {};
}
