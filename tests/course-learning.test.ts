import { describe, expect, it, vi } from "vitest";
import { editSignals } from "@/lib/courses/edits";
import { offlinePreferences, preferenceErrors, type EditEvidence } from "@/lib/courses/preferences";
import { learnedPreferences, managerPreferences } from "@/lib/courses/recall";
import type { CourseSpec } from "@/lib/flow/course-spec";
import { COURSE_ASSIST_SYSTEM_PROMPT, COURSE_PREFERENCES_SYSTEM_PROMPT } from "@/lib/prompts";

const base: CourseSpec = {
  title: "T",
  icon: "wrench",
  building: "W",
  game: "road",
  steps: [
    { id: "hi", kind: "welcome", title: "Hi", teaches_fact_ids: [] },
    { id: "a", kind: "lesson", title: "A", body: "1\n2\n3\n4", teaches_fact_ids: ["f"] },
    { id: "q", kind: "quiz", title: "Q", options: [{ label: "x", correct: true, why: "y" }, { label: "z", why: "w" }], teaches_fact_ids: ["f"] },
    { id: "bye", kind: "done", title: "Bye", teaches_fact_ids: [] },
  ],
};

const edit = (id: string, instruction: string, signals: string[], afterLines = 2): EditEvidence => ({
  id,
  packType: "tools-stack",
  instruction,
  summary: "",
  signals,
  before: [],
  after: [{ kind: "lesson", title: "A", lines: afterLines }],
});

describe("course learning: signals, distillation, generation hook", () => {
  it("derives structural signals from an edit", () => {
    const shorter = structuredClone(base);
    shorter.steps[1].body = "1\n2";
    shorter.steps.splice(2, 1, { id: "s", kind: "scenario", title: "S", body: "b", options: [{ label: "x", correct: true, why: "y" }, { label: "z", why: "w" }], teaches_fact_ids: ["f"] });
    expect(editSignals(base, shorter)).toEqual(["removed 1 quiz step", "added 1 scenario step", "lessons shortened to at most 2 lines", "rewrote lesson step"]);
  });

  it("offline distiller turns repeated edits into preferences citing their evidence", () => {
    const prefs = offlinePreferences([edit("e1", "swap the quiz for a scenario", ["removed 1 quiz step", "added 1 scenario step"]), edit("e2", "shorter lessons please", ["lessons shortened to at most 2 lines"])]);
    expect(prefs).toEqual([
      { text: "Prefer scenario steps over quizzes", evidence_edit_ids: ["e1"] },
      { text: "Keep lessons to 2 short lines or fewer", evidence_edit_ids: ["e2"] },
    ]);
    expect(preferenceErrors({ preferences: [{ text: "x y z", evidence_edit_ids: ["nope"] }] }, new Set(["e1"]))).toEqual(["preferences.0: unknown edit ids nope"]);
  });

  it("puts the space's preferences and Mubit memory recall in the generation message (once per job)", async () => {
    vi.stubEnv("MEMORY_PROVIDER", "");
    const query = vi.fn(async () => ({ company: "Acme", host: "acme.com", preferences: ["Prefer scenario steps over quizzes"] }));
    const ctx = { convex: { query, mutation: vi.fn() }, space: { _id: "s1" }, job: { _id: "j1" } } as never;
    const memory = { recall: vi.fn(async () => "Fintech managers keep lessons short."), remember: vi.fn(), recordOutcome: vi.fn() };
    expect(await learnedPreferences(ctx, memory)).toEqual(["Prefer scenario steps over quizzes", "From similar companies (Mubit memory): Fintech managers keep lessons short."]);
    expect(await managerPreferences(ctx)).toEqual({ manager_preferences: ["Prefer scenario steps over quizzes"] });
    await managerPreferences(ctx);
    expect(query).toHaveBeenCalledTimes(2); // one direct call above + one cached per job
    const none = { convex: { query: async () => ({ company: "", host: "", preferences: [] }) }, space: { _id: "s2" }, job: { _id: "j2" } } as never;
    expect(await managerPreferences(none)).toEqual({});
  });

  it("keeps the course.assist and course.preferences system prompts byte-identical", () => {
    expect(COURSE_ASSIST_SYSTEM_PROMPT).toMatchSnapshot();
    expect(COURSE_PREFERENCES_SYSTEM_PROMPT).toMatchSnapshot();
  });
});
