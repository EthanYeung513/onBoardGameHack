import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/grade/route";
import { setDb } from "@/db/client";
import { setLlm } from "@/llm";
import { cardByPrompt, seededDb } from "./helpers";

const post = (body: unknown) => POST(new Request("http://test/api/grade", { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/grade", () => {
  let learnerId = "";
  let cardId = "";
  beforeAll(async () => {
    const seeded = await seededDb();
    setDb(seeded.db);
    setLlm(undefined);
    learnerId = seeded.learnerId;
    cardId = (await cardByPrompt(seeded.db, "A merchant emails from their registered address")).id;
  });

  it("grades a free-text answer in offline mode", async () => {
    const res = await post({ learnerId, cardId, answerText: "I would call back on the number on file." });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.grade.mode).toBe("offline");
    expect(json.citation.heading).toBe("Bank detail changes");
  });

  it("returns 400 for a missing answer and 404 for an unknown card", async () => {
    expect((await post({ learnerId, cardId })).status).toBe(400);
    expect((await post({ learnerId, cardId: "nope", answerText: "x" })).status).toBe(404);
    expect((await post({ cardId })).status).toBe(400);
  });
});
