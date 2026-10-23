import { boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp } from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type PackType = "company" | "compliance" | "role";
export type CardType = "mcq" | "free_text" | "phish_email" | "incident";
export type CardStatus = "draft" | "approved" | "rejected" | "stale";
export type ModelVersionStatus = "candidate" | "promoted" | "blocked";
export type Scores = Record<string, number>;

/** What the grader is told about one competency: the policy it rests on and what each score means. */
export interface Rubric {
  competency: string;
  policy: string;
  levels: Record<"0" | "1" | "2" | "3", string>;
  /** Phrases that show the expected behaviour. Used by the offline grader only. */
  signals?: string[][];
  /** Phrases that mean the answer breaks policy. Used by the offline grader only. */
  redFlags?: string[];
}

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  joinCode: text("join_code").notNull().unique(),
  createdAt: createdAt(),
});

export const packs = pgTable("packs", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  slug: text("slug").notNull(),
  type: text("type").$type<PackType>().notNull(),
  role: text("role"),
  title: text("title").notNull(),
  createdAt: createdAt(),
});

export const docs = pgTable("docs", {
  id: id(),
  packId: text("pack_id")
    .notNull()
    .references(() => packs.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  version: integer("version").notNull().default(1),
  body: text("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const docChunks = pgTable("doc_chunks", {
  id: id(),
  docId: text("doc_id")
    .notNull()
    .references(() => docs.id),
  docVersion: integer("doc_version").notNull(),
  ord: integer("ord").notNull(),
  heading: text("heading").notNull(),
  text: text("text").notNull(),
  embedding: jsonb("embedding").$type<number[]>(),
});

export const gyms = pgTable("gyms", {
  id: id(),
  packId: text("pack_id")
    .notNull()
    .references(() => packs.id),
  name: text("name").notNull(),
  leaderName: text("leader_name").notNull(),
  building: text("building").notNull(),
  order: integer("order").notNull().default(0),
  locked: boolean("locked").notNull().default(false),
});

export const cards = pgTable("cards", {
  id: id(),
  gymId: text("gym_id")
    .notNull()
    .references(() => gyms.id),
  type: text("type").$type<CardType>().notNull(),
  competency: text("competency").notNull(),
  prompt: text("prompt").notNull(),
  choices: jsonb("choices").$type<string[]>(),
  answerIdx: integer("answer_idx"),
  rubric: jsonb("rubric").$type<Rubric>(),
  expertAnswer: text("expert_answer"),
  sourceChunkId: text("source_chunk_id").references(() => docChunks.id),
  docVersion: integer("doc_version").notNull(),
  status: text("status").$type<CardStatus>().notNull().default("approved"),
  isBoss: boolean("is_boss").notNull().default(false),
  createdAt: createdAt(),
});

/** Approve/edit/reject decisions on generated cards: the correction signal for the `generate` task. */
export const cardReviews = pgTable("card_reviews", {
  id: id(),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id),
  action: text("action").$type<"approve" | "edit" | "reject">().notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  reviewer: text("reviewer").notNull(),
  createdAt: createdAt(),
});

export const learners = pgTable("learners", {
  id: id(),
  companyId: text("company_id")
    .notNull()
    .references(() => companies.id),
  name: text("name").notNull(),
  role: text("role").notNull(),
  createdAt: createdAt(),
});

export const attempts = pgTable("attempts", {
  id: id(),
  learnerId: text("learner_id")
    .notNull()
    .references(() => learners.id),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id),
  answerText: text("answer_text"),
  choiceIdx: integer("choice_idx"),
  correct: boolean("correct").notNull(),
  createdAt: createdAt(),
});

export const grades = pgTable("grades", {
  id: id(),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => attempts.id),
  modelVersion: text("model_version").notNull(),
  model: text("model").notNull(),
  scores: jsonb("scores").$type<Scores>().notNull(),
  evidenceQuote: text("evidence_quote").notNull(),
  feedback: text("feedback").notNull(),
  gap: text("gap").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  costUsd: real("cost_usd").notNull().default(0),
  mubitRequestId: text("mubit_request_id"),
  retrievedCorrectionIds: jsonb("retrieved_correction_ids").$type<string[]>().notNull().default([]),
  reviewed: boolean("reviewed").notNull().default(false),
  createdAt: createdAt(),
});

export const corrections = pgTable("corrections", {
  id: id(),
  gradeId: text("grade_id")
    .notNull()
    .references(() => grades.id),
  correctedScores: jsonb("corrected_scores").$type<Scores>().notNull(),
  reason: text("reason").notNull(),
  reviewer: text("reviewer").notNull(),
  /** Embedding of the answer that was corrected, used to retrieve this correction for similar answers. */
  embedding: jsonb("embedding").$type<number[]>().notNull(),
  docVersion: integer("doc_version").notNull(),
  needsReview: boolean("needs_review").notNull().default(false),
  sentToMubit: boolean("sent_to_mubit").notNull().default(false),
  createdAt: createdAt(),
});

export const weaknesses = pgTable(
  "weaknesses",
  {
    learnerId: text("learner_id")
      .notNull()
      .references(() => learners.id),
    competency: text("competency").notNull(),
    attempts: integer("attempts").notNull().default(0),
    fails: integer("fails").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.learnerId, t.competency] })],
);

export const modelVersions = pgTable("model_versions", {
  id: id(),
  task: text("task").notNull(),
  label: text("label").notNull(),
  model: text("model").notNull(),
  trainedAt: timestamp("trained_at", { withTimezone: true }),
  heldOutAgreement: real("held_out_agreement"),
  withinOne: real("within_one"),
  mae: real("mae"),
  costPer1k: real("cost_per_1k"),
  p50Ms: integer("p50_ms"),
  p95Ms: integer("p95_ms"),
  status: text("status").$type<ModelVersionStatus>().notNull().default("candidate"),
  createdAt: createdAt(),
});
