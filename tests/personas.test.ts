import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { bulkGrade } from "@/data/bulk";
import { generatePersonaAnswers, offlinePersona, PERSONAS, type Persona, type PersonaRequest } from "@/data/personas";
import { OfflineClient } from "@/llm/offline";
import { TASKS } from "@/tasks/registry";
import { offlineGrade } from "@/tasks/offline-grade";
import { FakeLlm, seededDb } from "./helpers";

const req: PersonaRequest = {
  persona: "careless",
  scenario: "A merchant emails asking to change bank details today.",
  policy: "- Bank details only change after a callback to the phone number on file.",
  expertAnswer: "I call them back on the number on file.",
  redFlags: ["update the details"],
  count: 3,
};

describe("persona answers", () => {
  it("uses the fixed persona system prompt and returns exactly count answers", async () => {
    const llm = new FakeLlm([JSON.stringify({ answers: ["a one", "b two", "c three", "d four"] })]);
    expect(await generatePersonaAnswers(llm, "m", req)).toEqual(["a one", "b two", "c three"]);
    expect(llm.requests[0].system).toBe(TASKS.persona.system);
    expect(llm.requests[0].task).toBe("persona");
    expect(llm.requests[0].user).toContain("careless");
  });

  it("retries a short or invalid reply once, then fails", async () => {
    const ok = new FakeLlm(["nope", JSON.stringify({ answers: ["x one", "y two", "z three"] })]);
    expect(await generatePersonaAnswers(ok, "m", req)).toHaveLength(3);
    await expect(generatePersonaAnswers(new FakeLlm([JSON.stringify({ answers: ["only one"] })]), "m", req)).rejects.toThrow(/did not return 3/);
  });

  it("has an offline template for every persona", () => {
    for (const persona of Object.keys(PERSONAS) as Persona[]) {
      const { answers } = offlinePersona({ ...req, persona });
      expect(answers).toHaveLength(3);
      expect(answers.every((a) => a.length > 5)).toBe(true);
    }
    expect(offlinePersona(req).answers[0]).toContain("update the details");
  });
});

describe("bulkGrade", () => {
  it("grades synthetic answers through the normal path, one learner per persona", async () => {
    const { db } = await seededDb();
    const llm = new OfflineClient({ grade: offlineGrade });
    const card = "A merchant emails from their registered address";
    const { graded, failures } = await bulkGrade(db, llm, [
      { card, persona: "careless", answer: "I'd update the details today." },
      { card, persona: "model", answer: "I'd call back on the number on file and get 2FA approval in the app." },
      { card: "No such card", persona: "model", answer: "x" },
    ]);
    expect(graded).toBe(2);
    expect(failures).toEqual(['no approved free-text card starts with "No such card"']);
    expect((await db.select().from(t.learners)).map((l) => l.name).sort()).toEqual(["Persona: careless", "Persona: model", "Sam"]);
    expect(await db.select().from(t.grades)).toHaveLength(2);
  });
});
