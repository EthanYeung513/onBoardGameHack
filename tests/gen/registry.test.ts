import { describe, expect, it } from "vitest";
import { nextStage, ORDER, registry, stage } from "@/lib/pipeline/registry";
import { STAGE_LABELS } from "@/lib/pipeline/labels";
import { STAGES } from "@/lib/pipeline/types";

describe("stage registry", () => {
  it("registers every stage in pipeline order", () => {
    expect(ORDER).toEqual([...STAGES]);
    for (const name of STAGES) expect(stage(name).name).toBe(name);
    expect(Object.keys(registry).sort()).toEqual([...STAGES].sort());
  });

  it("chains stages and ends at ready", () => {
    expect(nextStage("crawl")).toBe("extract_design");
    expect(nextStage("awaiting_answers")).toBe("generate_flows");
    expect(nextStage("ready")).toBeNull();
  });

  it("marks only the two user gates as waiting stages", () => {
    const gates = STAGES.filter((s) => stage(s).waitsForUser);
    expect(gates).toEqual(["awaiting_confirmation", "awaiting_answers"]);
  });

  it("lets automatic stages retry up to three times", () => {
    for (const s of ["crawl", "extract_design", "analyse", "ask_questions", "generate_flows"] as const) expect(stage(s).maxAttempts).toBe(3);
  });

  it("has a display label for each stage in the same order", () => {
    expect(STAGE_LABELS.map((s) => s.key)).toEqual([...STAGES]);
  });
});
