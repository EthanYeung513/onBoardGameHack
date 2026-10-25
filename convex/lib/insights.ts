import type { Doc } from "../_generated/dataModel";
import { displayName, type HireProgress } from "./progress";

// F30: the dashboard assistant's insights, computed by fixed rules over real aggregates. Each
// insight is a list of segments so the UI can bold names without rendering HTML.

export type Segment = { text: string; bold?: boolean };
export type Insight = Segment[];

const DAY = 86_400_000;
const STALL_DAYS = 3;
/** Categories the gaps panel tracks ("Other" is a catch-all, not a topic hires learn). */
export const GAP_CATEGORIES: Doc<"facts">["category"][] = ["Glossary", "People", "Tools", "Rituals", "Docs & History", "Policy", "Product"];
/** A category with fewer approved facts than this is a knowledge gap. */
export const GAP_THRESHOLD = 3;

type Input = {
  hires: (HireProgress & { hire: Doc<"hires"> })[];
  courses: Doc<"courses">[];
  facts: Doc<"facts">[];
  connectors: Doc<"connectors">[];
  now: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function insightsFor({ hires, courses, facts, connectors, now }: Input): Insight[] {
  const out: Insight[] = [];
  const active = hires.filter((h) => h.hire.status !== "invited" || h.perCourse.size > 0);

  // The course the most active hires haven't entered yet.
  let worst: { course: Doc<"courses">; missing: number } | null = null;
  for (const course of courses) {
    const missing = active.filter((h) => !h.perCourse.has(course._id)).length;
    if (missing > 0 && (!worst || missing > worst.missing)) worst = { course, missing };
  }
  if (worst) out.push([{ text: `${plural(worst.missing, "hire")} haven't entered ` }, { text: worst.course.title, bold: true }, { text: " yet." }]);

  for (const h of hires) {
    if (h.progress <= 0 || h.progress >= 100 || !h.lastActivity) continue;
    const days = Math.floor((now - h.lastActivity) / DAY);
    if (days >= STALL_DAYS)
      out.push([{ text: displayName(h.hire), bold: true }, { text: ` is ${h.progress}% done but hasn't played for ${days} days — a nudge may help.` }]);
  }

  const invited = hires.filter((h) => h.hire.status === "invited" && h.perCourse.size === 0).length;
  if (invited) out.push([{ text: `${plural(invited, "invite")} not accepted yet.` }]);

  const refresh = courses.filter((c) => c.needsRefresh);
  if (refresh.length)
    out.push([{ text: `${plural(refresh.length, "course")} need a refresh — brain facts they teach changed: ` }, { text: refresh.map((c) => c.title).join(", "), bold: true }]);

  const counts = new Map<string, number>();
  for (const f of facts) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
  const thin = GAP_CATEGORIES.map((c) => [c, counts.get(c) ?? 0] as const).filter(([, n]) => n > 0 && n < GAP_THRESHOLD);
  for (const [category, n] of thin) out.push([{ text: category, bold: true }, { text: ` has only ${plural(n, "fact")} — connect a tool that covers it.` }]);

  for (const c of connectors.filter((c) => c.status === "error"))
    out.push([{ text: `${c.label ?? c.type} sync failed`, bold: true }, { text: c.error ? ` — ${c.error}` : "." }]);

  return out;
}
