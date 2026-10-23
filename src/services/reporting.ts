import { asc, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import * as t from "@/db/schema";
import { getWeaknesses } from "./adaptive";
import { NotFoundError } from "./errors";

export const AUDIT_MIN_ATTEMPTS = 2;
export const AUDIT_FAIL_RATE = 0.5;
export const XAPI_HOME = "https://gymquest.example";

/** Every attempt by a company's learners, with the card, gym and cited doc section. */
async function attemptRows(db: DB, companyId: string) {
  return db
    .select({ attempt: t.attempts, learner: t.learners, card: t.cards, gym: t.gyms, chunk: t.docChunks, doc: t.docs })
    .from(t.attempts)
    .innerJoin(t.learners, eq(t.attempts.learnerId, t.learners.id))
    .innerJoin(t.cards, eq(t.attempts.cardId, t.cards.id))
    .innerJoin(t.gyms, eq(t.cards.gymId, t.gyms.id))
    .leftJoin(t.docChunks, eq(t.cards.sourceChunkId, t.docChunks.id))
    .leftJoin(t.docs, eq(t.docChunks.docId, t.docs.id))
    .where(eq(t.learners.companyId, companyId))
    .orderBy(asc(t.attempts.createdAt));
}

export interface Passport {
  learner: { id: string; name: string; role: string };
  badges: { gymName: string; earnedAt: string }[];
  competencies: { competency: string; attempts: number; fails: number; status: "shown" | "gap" }[];
  attested: { docTitle: string; version: number }[];
}

/** One hire's skills passport: badges, competencies shown or still a gap, and the policy versions they passed on. */
export async function getPassport(db: DB, learnerId: string): Promise<Passport> {
  const [learner] = await db.select().from(t.learners).where(eq(t.learners.id, learnerId));
  if (!learner) throw new NotFoundError("Learner not found");
  const badges = await db
    .select({ gymName: t.gyms.name, earnedAt: t.badges.earnedAt })
    .from(t.badges)
    .innerJoin(t.gyms, eq(t.badges.gymId, t.gyms.id))
    .where(eq(t.badges.learnerId, learnerId))
    .orderBy(asc(t.badges.earnedAt));
  const records = await db.select().from(t.weaknesses).where(eq(t.weaknesses.learnerId, learnerId));
  const rows = (await attemptRows(db, learner.companyId)).filter((r) => r.learner.id === learnerId && r.attempt.correct && r.doc);
  const attested = new Map<string, { docTitle: string; version: number }>();
  for (const r of rows) {
    const prev = attested.get(r.doc!.id);
    if (!prev || prev.version < r.card.docVersion) attested.set(r.doc!.id, { docTitle: r.doc!.title, version: r.card.docVersion });
  }
  return {
    learner: { id: learner.id, name: learner.name, role: learner.role },
    badges: badges.map((b) => ({ gymName: b.gymName, earnedAt: b.earnedAt.toISOString() })),
    competencies: records
      .map((r) => ({ competency: r.competency, attempts: r.attempts, fails: r.fails, status: (r.attempts && r.fails / r.attempts >= AUDIT_FAIL_RATE ? "gap" : "shown") as "gap" | "shown" }))
      .sort((a, b) => a.competency.localeCompare(b.competency)),
    attested: [...attested.values()],
  };
}

export interface DocFlag {
  cardId: string;
  prompt: string;
  gymName: string;
  docTitle: string | null;
  heading: string | null;
  attempts: number;
  fails: number;
  failRate: number;
}

/** "The game audits the docs": cards most hires get wrong point at sections that may be unclear or missing. */
export async function getDocAudit(db: DB, companyId: string): Promise<DocFlag[]> {
  const byCard = new Map<string, DocFlag>();
  for (const r of await attemptRows(db, companyId)) {
    const flag = byCard.get(r.card.id) ?? {
      cardId: r.card.id,
      prompt: r.card.prompt,
      gymName: r.gym.name,
      docTitle: r.doc?.title ?? null,
      heading: r.chunk?.heading ?? null,
      attempts: 0,
      fails: 0,
      failRate: 0,
    };
    flag.attempts++;
    if (!r.attempt.correct) flag.fails++;
    flag.failRate = flag.fails / flag.attempts;
    byCard.set(r.card.id, flag);
  }
  return [...byCard.values()].filter((f) => f.attempts >= AUDIT_MIN_ATTEMPTS && f.failRate >= AUDIT_FAIL_RATE).sort((a, b) => b.failRate - a.failRate || b.attempts - a.attempts);
}

/** The manager's view: who is ready for what, and which gyms (systems) too few people have cleared. */
export async function getReadiness(db: DB, companyId: string) {
  const learners = await db.select().from(t.learners).where(eq(t.learners.companyId, companyId)).orderBy(desc(t.learners.createdAt));
  const gyms = await db
    .select({ gym: t.gyms, pack: t.packs })
    .from(t.gyms)
    .innerJoin(t.packs, eq(t.gyms.packId, t.packs.id))
    .where(eq(t.packs.companyId, companyId))
    .orderBy(asc(t.gyms.order));
  const badges = await db.select().from(t.badges);
  const attempts = await attemptRows(db, companyId);
  const active = new Set(attempts.map((a) => a.learner.id));

  const learnerRows = [];
  for (const l of learners) {
    if (!active.has(l.id)) continue;
    learnerRows.push({
      id: l.id,
      name: l.name,
      role: l.role,
      badges: badges.filter((b) => b.learnerId === l.id).length,
      answered: attempts.filter((a) => a.learner.id === l.id).length,
      gaps: (await getWeaknesses(db, l.id)).filter((w) => w.failRate >= AUDIT_FAIL_RATE).map((w) => w.competency),
    });
  }
  return {
    gyms: gyms
      .filter(({ gym }) => !gym.locked)
      .map(({ gym, pack }) => ({ id: gym.id, name: gym.name, packTitle: pack.title, cleared: badges.filter((b) => b.gymId === gym.id).length })),
    learners: learnerRows,
    activeLearners: learnerRows.length,
    docFlags: await getDocAudit(db, companyId),
  };
}

export interface XapiStatement {
  id: string;
  actor: { objectType: "Agent"; name: string; account: { homePage: string; name: string } };
  verb: { id: string; display: { "en-GB": string } };
  object: { objectType: "Activity"; id: string; definition: { name: { "en-GB": string }; type: string } };
  result: { success: boolean; completion: true; score?: { scaled: number; raw: number; min: 0; max: 3 } };
  context: { extensions: Record<string, unknown> };
  timestamp: string;
}

/**
 * Every attempt as an xAPI statement, so completions land in the customer's LMS. The policy version is in the
 * activity id, which answers "which version did they attest to" (PLAN.md §4). Actors are identified by account,
 * never by email.
 */
export async function getXapiStatements(db: DB, learnerId: string): Promise<XapiStatement[]> {
  const [learner] = await db.select().from(t.learners).where(eq(t.learners.id, learnerId));
  if (!learner) throw new NotFoundError("Learner not found");
  const [company] = await db.select().from(t.companies).where(eq(t.companies.id, learner.companyId));
  const rows = (await attemptRows(db, learner.companyId)).filter((r) => r.learner.id === learnerId);
  const grades = new Map(
    (await db.select().from(t.grades)).map((g) => [g.attemptId, g]),
  );
  return rows.map(({ attempt, card, doc }) => {
    const grade = grades.get(attempt.id);
    const raw = grade ? Math.min(...Object.values(grade.scores)) : undefined;
    const policy = doc ? `policies/${doc.slug}/v${card.docVersion}` : "cards";
    return {
      id: attempt.id,
      actor: { objectType: "Agent", name: learner.name, account: { homePage: XAPI_HOME, name: learner.id } },
      verb: attempt.correct
        ? { id: "http://adlnet.gov/expapi/verbs/passed", display: { "en-GB": "passed" } }
        : { id: "http://adlnet.gov/expapi/verbs/failed", display: { "en-GB": "failed" } },
      object: {
        objectType: "Activity",
        id: `${XAPI_HOME}/${company.slug}/${policy}/cards/${card.id}`,
        definition: { name: { "en-GB": card.prompt.slice(0, 120) }, type: "http://adlnet.gov/expapi/activities/assessment" },
      },
      result: { success: attempt.correct, completion: true, ...(raw != null ? { score: { scaled: raw / 3, raw, min: 0 as const, max: 3 as const } } : {}) },
      context: { extensions: { [`${XAPI_HOME}/xapi/competency`]: card.competency, [`${XAPI_HOME}/xapi/policy-version`]: card.docVersion } },
      timestamp: attempt.createdAt.toISOString(),
    };
  });
}
