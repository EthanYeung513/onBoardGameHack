// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";
import type { CourseSpec } from "@/lib/flow/course-spec";
import { preferredGames } from "@/lib/world/build";
import { createEmbedder, hashedEmbedding } from "@/worker/providers/embed";
import { createLlm, type JsonRequest, type Llm } from "@/worker/providers/llm";
import { runSlice } from "@/worker/runner";
import { generateCoursesStage } from "@/worker/stages/generate-courses";
import type { WorkerConvex } from "@/worker/types";

// F22: "Create a course" with a topic builds a course about it from the brain's relevant facts.

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);
const secret = "test-secret";
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;
type Category = "Tools" | "People" | "Policy" | "Product";

async function setup(facts: { text: string; category: Category; status?: "approved" | "draft" }[]) {
  const t = makeT();
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "nicole@acme.com" }));
  const mgr = t.withIdentity({ subject: `${userId}|s` });
  const { spaceId } = await mgr.mutation(api.spaces.create, { name: "Acme Pay", website: "acmepay.example" });
  const connectorId = await t.mutation(api.ingest.ensureConnector, { secret, spaceId, type: "slack" });
  const ids: Id<"facts">[] = [];
  for (const [i, f] of facts.entries()) {
    const { sourceItemId, version } = await t.mutation(api.ingest.upsertItem, { secret, spaceId, connectorId, kind: "message", externalId: `m${i}`, title: `m${i}`, contentHash: `h${i}` });
    ids.push(
      await t.run(async (ctx) => {
        const chunkId = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId, version, idx: 0, text: f.text, tokens: 10, embedding: hashedEmbedding(f.text) });
        const factId = await ctx.db.insert("facts", { spaceId, category: f.category, text: f.text, confidence: 0.9, sourceChunkIds: [chunkId], status: f.status ?? "approved", createdBy: "agent", version: 1 });
        await ctx.db.insert("fact_citations", { spaceId, factId, chunkId, sourceItemId });
        return factId;
      }),
    );
  }
  return { t, mgr, spaceId, ids };
}

const workerConvex = (t: T): WorkerConvex => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: ((fn: any, args: object) => t.query(fn, { ...args, secret })) as never,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: ((fn: any, args: object) => t.mutation(fn, { ...args, secret })) as never,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: ((fn: any, args: object) => t.action(fn, { ...args, secret })) as never,
});

async function runCourseJob(t: T, llm: Llm = createLlm()) {
  const claimed = await t.mutation(api.pipeline.claim, { secret, workerId: "w", stages: ["generate_courses"] });
  expect(claimed).not.toBeNull();
  const outcome = await runSlice(claimed!, { convex: workerConvex(t), llm, embed: createEmbedder(), workerId: "w", registry: { generate_courses: generateCoursesStage }, heartbeatMs: 60_000 });
  if (outcome === "error") throw new Error((await t.run((ctx) => ctx.db.get(claimed!.job._id)))?.error);
  return outcome;
}

const SECURITY = [
  { category: "Policy" as const, text: "Security reviews are required before any new vendor gets production access." },
  { category: "Tools" as const, text: "Every laptop must use full-disk encryption; security checks this weekly." },
  { category: "Policy" as const, text: "Report a phishing email to the security channel within an hour." },
];
const OTHER = [
  { category: "People" as const, text: "Marco owns the deploy pipeline." },
  { category: "Product" as const, text: "Pricing: the Business plan costs $16 per user per month." },
  { category: "Tools" as const, text: "Staging deploys happen on merge to main." },
];

describe("topic courses (F22)", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", secret);
    vi.stubEnv("MUBIT_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("typing a topic queues a course about it, shown as generating, built only from facts about it", async () => {
    const { t, mgr, spaceId, ids } = await setup([...SECURITY, ...OTHER, { category: "Policy", text: "Security keys are issued on day one.", status: "draft" }]);
    const r = await mgr.mutation(api.courses.generate, { spaceId, topic: "  security " });
    expect(r).toMatchObject({ queued: ["topic-security"], title: "Security" });
    expect(await mgr.query(api.courses.generating, { spaceId })).toEqual([expect.objectContaining({ packType: "topic-security", title: "Security" })]);
    expect(await mgr.query(api.courses.outcome, { jobId: r.jobId!, packType: "topic-security" })).toMatchObject({ status: "queued", built: false });

    expect(await runCourseJob(t)).toBe("done");
    const course = await t.run((ctx) => ctx.db.query("courses").withIndex("by_space_pack", (q) => q.eq("spaceId", spaceId).eq("packType", "topic-security")).first());
    expect(course).toMatchObject({ title: "Security", mode: "offline", status: "draft" });
    const cited = new Set((course!.spec as CourseSpec).steps.flatMap((s) => s.teaches_fact_ids));
    expect(cited).toEqual(new Set(ids.slice(0, 3))); // the three security facts; never the draft or unrelated ones
    expect(await mgr.query(api.courses.generating, { spaceId })).toEqual([]);
    expect(await mgr.query(api.courses.outcome, { jobId: r.jobId!, packType: "topic-security" })).toMatchObject({ status: "succeeded", built: true, skipped: [] });
    // It plays in the world: a security course is a judgment-call game.
    expect(preferredGames({ packType: course!.packType, title: course!.title, spec: course!.spec })[0]).toBe("dilemma");
  });

  it("too few facts about the topic: says so honestly and builds nothing", async () => {
    const { t, mgr, spaceId } = await setup([SECURITY[0], ...OTHER]);
    const { jobId } = await mgr.mutation(api.courses.generate, { spaceId, topic: "Security" });
    expect(await runCourseJob(t)).toBe("done");
    expect(await t.run((ctx) => ctx.db.query("courses").collect())).toEqual([]);
    const out = await mgr.query(api.courses.outcome, { jobId: jobId!, packType: "topic-security" });
    expect(out).toMatchObject({ status: "succeeded", built: false });
    expect(out.skipped).toEqual([{ packType: "topic-security", message: "Only 1 fact about security in your brain. Connect a tool or upload a doc that covers it." }]);
  });

  it("an empty topic is rejected with the mockup's copy", async () => {
    const { mgr, spaceId } = await setup([]);
    await expect(mgr.mutation(api.courses.generate, { spaceId, topic: "   " })).rejects.toThrow(/Type a course name first/);
  });

  it("writes several courses at once (one LLM call each), not one after another", async () => {
    vi.stubEnv("MUBIT_API_KEY", "");
    const { t, mgr, spaceId } = await setup([...SECURITY, ...OTHER, { category: "Product", text: "Pricing: the Basic plan costs $10 per user per month." }, { category: "Product", text: "Pricing is billed yearly on every paid plan." }]);
    await mgr.mutation(api.courses.generate, { spaceId, topic: "Security" });
    await mgr.mutation(api.courses.generate, { spaceId, topic: "Pricing" });
    const base = createLlm();
    let inFlight = 0;
    let peak = 0;
    const llm: Llm = {
      live: false,
      async json<V>(req: JsonRequest<V>) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight--;
        return base.json(req);
      },
    };
    expect(await runCourseJob(t, llm)).toBe("done");
    expect(peak).toBe(2);
    expect((await t.run((ctx) => ctx.db.query("courses").collect())).map((c) => c.title).sort()).toEqual(["Pricing", "Security"]);
  });
});
