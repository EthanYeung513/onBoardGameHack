import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { createCardFromChunk } from "@/services/cards";
import { GenerateError, generateCard, validateGenerated, type GenerateInput } from "@/tasks/generate";
import { kebab, offlineGenerate, sectionRules } from "@/tasks/offline-generate";
import { FakeLlm, seededDb } from "./helpers";

const input: GenerateInput = {
  packTitle: "Warehouse Ops",
  role: "Operations",
  docTitle: "Warehouse handbook",
  heading: "Cold chain",
  text: "- Chilled stock stays between 0 and 5°C.\n- Log the temperature at every handover.\n- Quarantine anything above 8°C.",
  type: "free_text",
};

const validFree = JSON.stringify({
  type: "free_text",
  competency: "cold-chain",
  prompt: "A delivery arrives at 9°C and the driver is in a hurry. What do you do?",
  choices: null,
  answer_idx: null,
  levels: { "0": "Accepts it", "1": "Hesitates", "2": "Rejects without logging", "3": "Quarantines and logs" },
  expert_answer: "Quarantine it and log the temperature.",
});

describe("validateGenerated", () => {
  it("enforces choices for mcq and levels for free text", () => {
    expect(validateGenerated(validFree, "free_text").ok).toBe(true);
    expect(validateGenerated(validFree, "mcq")).toMatchObject({ ok: false });
    const badMcq = JSON.stringify({ type: "mcq", competency: "x", prompt: "Which one is right here?", choices: ["a", "b"], answer_idx: 0, levels: null, expert_answer: "a" });
    expect(validateGenerated(badMcq, "mcq")).toMatchObject({ ok: false, error: expect.stringContaining("4 choices") });
    const badKebab = JSON.stringify({ ...JSON.parse(validFree), competency: "Cold Chain" });
    expect(validateGenerated(badKebab, "free_text")).toMatchObject({ ok: false });
  });
});

describe("generateCard", () => {
  it("retries once, then throws on a second invalid reply", async () => {
    const llm = new FakeLlm(["nope", validFree]);
    expect((await generateCard(llm, "m", input)).card.competency).toBe("cold-chain");
    expect(llm.requests[0].user).toContain("Cold chain");
    await expect(generateCard(new FakeLlm(["nope", "nope"]), "m", input)).rejects.toBeInstanceOf(GenerateError);
  });
});

describe("offlineGenerate", () => {
  it("produces a valid card of every type from the section's own rules", () => {
    for (const type of ["mcq", "free_text", "phish_email", "incident"] as const) {
      const card = offlineGenerate({ ...input, type });
      expect(validateGenerated(JSON.stringify(card), type).ok).toBe(true);
    }
    expect(offlineGenerate({ ...input, type: "mcq" }).choices?.[0]).toBe("Chilled stock stays between 0 and 5°C.");
    expect(sectionRules("Plain sentence that is long enough. Another sentence also long enough.")).toHaveLength(2);
    expect(kebab("Bank detail changes!")).toBe("bank-detail-changes");
  });
});

describe("createCardFromChunk", () => {
  it("stores a draft card citing the chunk and its doc version", async () => {
    const { db } = await seededDb();
    const [chunk] = await db.select().from(t.docChunks).limit(1);
    const [gym] = await db.select().from(t.gyms).limit(1);
    const card = await createCardFromChunk(db, new OfflineClient({ generate: offlineGenerate }), { chunkId: chunk.id, gymId: gym.id, type: "free_text", role: "Customer Support" });
    expect(card.status).toBe("draft");
    expect(card.sourceChunkId).toBe(chunk.id);
    expect(card.docVersion).toBe(chunk.docVersion);
    expect(card.rubric?.policy).toBe(chunk.text);
  });
});
