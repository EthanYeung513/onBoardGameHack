import { describe, expect, it } from "vitest";
import { packFor, topicPack, topicPackType } from "@/lib/flow/course-packs";
import { hashedEmbedding } from "@/worker/providers/embed";
import { factsForCourse, LIVE_MIN_SIMILARITY, rankTopicFacts, topicTerms } from "@/worker/stages/course-facts";
import type { CourseFact } from "@/worker/stages/course-offline";
import { tooFewTopicFacts } from "@/worker/stages/generate-courses";
import type { StageContext } from "@/worker/types";

const fact = (id: string, text: string, category = "Policy"): CourseFact => ({ id, text, category, confidence: 0.9 });

describe("topic fact selection (F22)", () => {
  it("keeps a topic's meaningful words, stemmed ('Security best practices' → secur)", () => {
    expect(topicTerms("Security best practices")).toEqual(["secur"]);
    expect(topicTerms("Pricing & billing")).toEqual(["pric", "bill"]);
  });

  it("counts a fact when it names the topic or is semantically close; never pads with the rest", () => {
    const facts = [
      fact("kw", "Security reviews are required for every new vendor."),
      fact("sem", "Laptops use full-disk encryption and SSO."),
      fact("far", "Marco owns the deploy pipeline.", "People"),
      fact("near-miss", "Lunch is on Fridays.", "Rituals"),
    ];
    const similarity = new Map([["sem", 0.41], ["far", 0.12], ["near-miss", LIVE_MIN_SIMILARITY - 0.02]]);
    const ranked = rankTopicFacts("Security", facts, { similarity, lexical: new Set(), minSimilarity: LIVE_MIN_SIMILARITY }, 10);
    expect(ranked.map((f) => f.id).sort()).toEqual(["kw", "sem"]);
    // Offline: only facts that share the topic's words count.
    expect(rankTopicFacts("Security", facts, { similarity, lexical: new Set(), minSimilarity: Infinity }, 10).map((f) => f.id)).toEqual(["kw"]);
  });

  it("topic packs: a stable id, a sensible building and game, and the topic as the title", () => {
    expect(topicPackType("Security best practices!")).toBe("topic-security-best-practices");
    expect(topicPack("security")).toMatchObject({ packType: "topic-security", title: "Security", building: "Watchtower", game: "scenario", topic: "Security" });
    expect(packFor("topic-security", "Security")?.title).toBe("Security");
    expect(packFor("company")?.topic).toBeUndefined();
  });

  it("a default pack whose categories the brain lacks falls back to relevant facts", async () => {
    const ctx = { embed: { mode: "offline", embed: async (t: string[]) => t.map((x) => hashedEmbedding(x)) }, convex: {}, space: { _id: "s" } } as unknown as StageContext;
    const facts = [fact("p1", "Our mission: make payments simple.", "Product"), fact("p2", "Payments settle in two days.", "Product"), fact("x", "Lunch is on Fridays.", "Rituals")];
    // Tools & Stack has no Tools facts here, and nothing matches its outline: nothing is invented.
    expect(await factsForCourse(ctx, packFor("tools-stack")!, facts, 14)).toEqual([]);
    const payments = { ...packFor("company")!, title: "Payments", desc: "Payments.", lessons: [], categories: ["Glossary" as const] };
    expect((await factsForCourse(ctx, payments, facts, 14)).map((f) => f.id).sort()).toEqual(["p1", "p2"]);
  });

  it("the too-few message is honest and points at what to do", () => {
    expect(tooFewTopicFacts("Security", 2)).toBe("Only 2 facts about security in your brain. Connect a tool or upload a doc that covers it.");
    expect(tooFewTopicFacts("SOC 2", 0)).toBe("No facts about SOC 2 in your brain yet. Connect a tool or upload a doc that covers it.");
  });
});
