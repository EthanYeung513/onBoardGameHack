import { describe, expect, it } from "vitest";
import * as t from "@/db/schema";
import { OfflineClient } from "@/llm/offline";
import { retrieveCorrections } from "@/services/corrections";
import { submitAnswer } from "@/services/grading";
import { getDocAudit, getPassport, getReadiness, getXapiStatements, XAPI_HOME } from "@/services/reporting";
import { awardBadge, joinCompany } from "@/services/world";
import { offlineGrade } from "@/tasks/offline-grade";
import { cardByPrompt, seededDb } from "./helpers";

const llm = new OfflineClient({ grade: offlineGrade });
const REFUND_MCQ = "A merchant asks for a £400 refund";

describe("doc audit", () => {
  it("flags a card once at least half of at least two attempts fail", async () => {
    const { db, companyId, learnerId } = await seededDb();
    const card = await cardByPrompt(db, REFUND_MCQ);
    const { learner: other } = await joinCompany(db, { joinCode: "ACME", name: "Bo", role: "Customer Support" });

    await submitAnswer(db, llm, { learnerId, cardId: card.id, choiceIdx: 0 }, retrieveCorrections);
    expect(await getDocAudit(db, companyId)).toHaveLength(0);

    await submitAnswer(db, llm, { learnerId: other.id, cardId: card.id, choiceIdx: card.answerIdx! }, retrieveCorrections);
    const flags = await getDocAudit(db, companyId);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ attempts: 2, fails: 1, failRate: 0.5, heading: "Refunds", docTitle: "Acme Pay customer support playbook" });

    await submitAnswer(db, llm, { learnerId: other.id, cardId: card.id, choiceIdx: card.answerIdx! }, retrieveCorrections);
    expect(await getDocAudit(db, companyId)).toHaveLength(0);
  });
});

describe("xAPI export", () => {
  it("emits one statement per attempt with the policy version in the activity id and no email", async () => {
    const { db, learnerId } = await seededDb();
    const mcq = await cardByPrompt(db, REFUND_MCQ);
    const free = await cardByPrompt(db, "A merchant emails from their registered address");
    await submitAnswer(db, llm, { learnerId, cardId: mcq.id, choiceIdx: mcq.answerIdx! }, retrieveCorrections);
    await submitAnswer(db, llm, { learnerId, cardId: free.id, answerText: "I'd update the details today." }, retrieveCorrections);

    const [passed, graded] = await getXapiStatements(db, learnerId);
    expect(passed.verb.id).toBe("http://adlnet.gov/expapi/verbs/passed");
    expect(passed.object.id).toBe(`${XAPI_HOME}/acme-pay/policies/support-playbook/v1/cards/${mcq.id}`);
    expect(passed.actor).toEqual({ objectType: "Agent", name: "Sam", account: { homePage: XAPI_HOME, name: learnerId } });
    expect(passed.result).toEqual({ success: true, completion: true });
    expect(graded.verb.display["en-GB"]).toBe("failed");
    expect(graded.result.score).toMatchObject({ min: 0, max: 3 });
    expect(graded.result.score!.scaled).toBeCloseTo(graded.result.score!.raw / 3);
    expect(JSON.stringify([passed, graded])).not.toMatch(/mbox|@/);
    expect(Date.parse(passed.timestamp)).not.toBeNaN();
  });
});

describe("passport and readiness", () => {
  it("shows badges, competencies and attested policy versions; readiness lists gyms and gaps", async () => {
    const { db, companyId, learnerId } = await seededDb();
    const mcq = await cardByPrompt(db, REFUND_MCQ);
    const postcode = await cardByPrompt(db, "A caller fails the postcode check");
    await submitAnswer(db, llm, { learnerId, cardId: mcq.id, choiceIdx: mcq.answerIdx! }, retrieveCorrections);
    await submitAnswer(db, llm, { learnerId, cardId: postcode.id, choiceIdx: 0 }, retrieveCorrections);
    await awardBadge(db, learnerId, mcq.gymId);

    const passport = await getPassport(db, learnerId);
    expect(passport.badges.map((b) => b.gymName)).toEqual(["Support Gym"]);
    expect(passport.competencies).toEqual([
      { competency: "account-security", attempts: 1, fails: 1, status: "gap" },
      { competency: "refunds", attempts: 1, fails: 0, status: "shown" },
    ]);
    expect(passport.attested).toEqual([{ docTitle: "Acme Pay customer support playbook", version: 1 }]);

    const readiness = await getReadiness(db, companyId);
    expect(readiness.activeLearners).toBe(1);
    expect(readiness.learners[0]).toMatchObject({ name: "Sam", badges: 1, answered: 2, gaps: ["account-security"] });
    expect(readiness.gyms.find((g) => g.name === "Support Gym")?.cleared).toBe(1);
    expect(readiness.gyms.find((g) => g.name === "Security HQ")?.cleared).toBe(0);
    expect((await db.select().from(t.badges)).length).toBe(1);
  });
});
