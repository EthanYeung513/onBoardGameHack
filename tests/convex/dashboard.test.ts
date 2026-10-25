// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { resetBatch } from "@convex/lib/reset";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

async function setup() {
  const t = convexTest(schema, modules);
  const user = async (email: string) => {
    const userId = await t.run((ctx) => ctx.db.insert("users", { email }));
    return { userId, as: t.withIdentity({ subject: `${userId}|session` }) };
  };
  const owner = await user("dana@acme.com");
  const { spaceId, slug } = await owner.as.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  return { t, user, owner, spaceId, slug };
}

const step = (kind: string, title: string) => ({ kind, title, teaches_fact_ids: [] });

async function fixtures(t: Awaited<ReturnType<typeof setup>>["t"], spaceId: Id<"spaces">) {
  return t.run(async (ctx) => {
    const spec = { steps: [step("welcome", "Hi"), step("lesson", "Origin story"), step("quiz", "Glossary"), step("done", "Bye")] };
    const base = { spaceId, packType: "basics", icon: "landmark", building: "HQ Hall", game: "quiz" as const, spec, status: "draft" as const, version: 1 };
    const c1 = await ctx.db.insert("courses", { ...base, title: "Company 101", needsRefresh: false });
    const c2 = await ctx.db.insert("courses", { ...base, title: "Tools & Stack", needsRefresh: true, staleStepIds: ["s2"] });
    const h1 = await ctx.db.insert("hires", { spaceId, email: "mateo@acme.com", name: "Mateo Brooks", status: "onboarding", coins: 340 });
    const h2 = await ctx.db.insert("hires", { spaceId, email: "sofia@acme.com", status: "invited", coins: 0 });
    // Mateo finished Company 101 (both scored steps) and started Tools & Stack.
    for (const [courseId, stepId, score] of [[c1, "1", 80], [c1, "2", 60], [c2, "1", 0.5]] as const)
      await ctx.db.insert("attempts", { spaceId, hireId: h1, courseId, stepId, result: {}, score });
    const chunk = await ctx.db.insert("source_items", { spaceId, kind: "page", externalId: "x", title: "x", contentHash: "h", version: 1, fetchedAt: 0 });
    const chunkId = await ctx.db.insert("doc_chunks", { spaceId, sourceItemId: chunk, version: 1, idx: 0, text: "t", tokens: 1 });
    const fact = (category: "Glossary" | "People", status: "approved" | "draft") =>
      ctx.db.insert("facts", { spaceId, category, text: "f", confidence: 1, sourceChunkIds: [chunkId], status, createdBy: "agent", version: 1 });
    for (let i = 0; i < 3; i++) await fact("People", "approved");
    await fact("Glossary", "approved");
    await fact("Glossary", "draft");
    return { c1, c2, h1, h2 };
  });
}

describe("dashboard aggregates", () => {
  it("returns zeros and empty lists for a new space — never demo people", async () => {
    const { owner, spaceId } = await setup();
    const o = await owner.as.query(api.dashboard.overview, { spaceId });
    expect(o.kpis).toEqual({ facts: 0, team: 0, courses: 0, onTrack: 0 });
    expect(o.hires).toEqual([]);
    expect(await owner.as.query(api.dashboard.courses, { spaceId })).toEqual([]);
    expect(await owner.as.query(api.dashboard.tools, { spaceId })).toEqual({ facts: 0, connectors: [] });
    const a = await owner.as.query(api.dashboard.analytics, { spaceId });
    expect(a.hires).toEqual([]);
    expect(a.gaps.map((g) => g.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(await owner.as.query(api.dashboard.insights, { spaceId })).toEqual([]);
  });

  it("computes KPIs, progress, completion, scores and gaps from real rows", async () => {
    const { t, owner, spaceId } = await setup();
    const { c2 } = await fixtures(t, spaceId);
    const o = await owner.as.query(api.dashboard.overview, { spaceId });
    expect(o.kpis).toEqual({ facts: 4, team: 2, courses: 2, onTrack: 0 });
    expect(o.hires.map((h) => [h.name, h.progress, h.coursesDone, h.status])).toEqual([
      ["Mateo Brooks", 50, 1, "onboarding"],
      ["sofia", 0, 0, "invited"],
    ]);

    const courses = await owner.as.query(api.dashboard.courses, { spaceId });
    expect(courses.find((c) => c._id === c2)).toMatchObject({ needsRefresh: true, staleSteps: 1, lessons: ["Origin story", "Glossary"], steps: 2 });

    const a = await owner.as.query(api.dashboard.analytics, { spaceId });
    expect(a.courses.map((c) => c.completion)).toEqual([50, 0]);
    expect(a.hires[0].scores).toEqual([70, 50]);
    expect(a.gaps.find((g) => g.category === "Glossary")).toEqual({ category: "Glossary", count: 1 });
    expect(a.gaps.find((g) => g.category === "People")).toBeUndefined();

    const insights = (await owner.as.query(api.dashboard.insights, { spaceId })).map((i) => i.map((s) => s.text).join(""));
    expect(insights).toContain("1 invite not accepted yet.");
    expect(insights.some((i) => i.includes("Tools & Stack") && i.includes("refresh"))).toBe(true);
    expect(insights).toContain("Glossary has only 1 fact — connect a tool that covers it.");
  });

  it("counts unprocessed diff_events per connector on the Tools tab", async () => {
    const { t, owner, spaceId } = await setup();
    await t.run(async (ctx) => {
      const connectorId = await ctx.db.insert("connectors", { spaceId, type: "slack", status: "ready", lastSyncedAt: 1000 });
      const item = await ctx.db.insert("source_items", { spaceId, connectorId, kind: "message", externalId: "m", title: "m", contentHash: "h", version: 1, fetchedAt: 0 });
      await ctx.db.insert("diff_events", { spaceId, kind: "added", sourceItemId: item, summary: "s" });
      await ctx.db.insert("diff_events", { spaceId, kind: "changed", sourceItemId: item, summary: "s", processedAt: 5 });
    });
    const tools = await owner.as.query(api.dashboard.tools, { spaceId });
    expect(tools.connectors).toMatchObject([{ type: "slack", status: "ready", lastSyncedAt: 1000, pendingChanges: 1 }]);
  });

  it("is manager-only", async () => {
    const { t, user, spaceId } = await setup();
    const hire = await user("hire@acme.com");
    await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: hire.userId, role: "hire" }));
    await expect(hire.as.query(api.dashboard.overview, { spaceId })).rejects.toThrow(/403/);
    await expect(t.query(api.dashboard.analytics, { spaceId })).rejects.toThrow(/401/);
  });
});

describe("hires.invite", () => {
  it("creates an invited hire + token and reuses the open invite on re-invite", async () => {
    const { t, owner, spaceId, slug } = await setup();
    const first = await owner.as.mutation(api.hires.invite, { spaceId, email: " Sam@Acme.com " });
    expect(first.path).toBe(`/join/${slug}?invite=${first.token}`);
    expect(first.emailSent).toBe(false);
    const again = await owner.as.mutation(api.hires.invite, { spaceId, email: "sam@acme.com" });
    expect(again).toMatchObject({ hireId: first.hireId, token: first.token });
    const rows = await t.run(async (ctx) => ({
      hires: await ctx.db.query("hires").collect(),
      invites: await ctx.db.query("hire_invites").collect(),
      audits: await ctx.db.query("audit_events").filter((q) => q.eq(q.field("kind"), "hire.invited")).collect(),
    }));
    expect(rows.hires).toMatchObject([{ email: "sam@acme.com", status: "invited", coins: 0 }]);
    expect(rows.invites).toHaveLength(1);
    expect(rows.audits).toHaveLength(2);
    await expect(owner.as.mutation(api.hires.invite, { spaceId, email: "nope" })).rejects.toThrow(/422/);
  });
});

describe("rewards", () => {
  it("supports catalog CRUD, gifting to a hire and lists redemptions", async () => {
    const { t, owner, user, spaceId } = await setup();
    const rewardId = await owner.as.mutation(api.rewards.create, { spaceId, name: "Coffee voucher — $5", costCoins: 120 });
    await owner.as.mutation(api.rewards.update, { rewardId, costCoins: 150 });
    await expect(owner.as.mutation(api.rewards.create, { spaceId, name: "", costCoins: 10 })).rejects.toThrow(/422/);
    await expect(owner.as.mutation(api.rewards.create, { spaceId, name: "x", costCoins: 0 })).rejects.toThrow(/422/);

    await expect(owner.as.mutation(api.rewards.send, { rewardId, email: "ghost@acme.com" })).rejects.toThrow(/404/);
    await owner.as.mutation(api.hires.invite, { spaceId, email: "sam@acme.com", name: "Sam Lee" });
    await owner.as.mutation(api.rewards.send, { rewardId, email: "sam@acme.com" });

    let list = await owner.as.query(api.rewards.list, { spaceId });
    expect(list.rewards).toEqual([{ _id: rewardId, name: "Coffee voucher — $5", costCoins: 150 }]);
    expect(list.redemptions).toMatchObject([{ hireName: "Sam Lee", rewardName: "Coffee voucher — $5", status: "fulfilled" }]);

    const outsider = await user("eve@evil.com");
    await expect(outsider.as.mutation(api.rewards.remove, { rewardId })).rejects.toThrow(/403/);
    await owner.as.mutation(api.rewards.remove, { rewardId });
    list = await owner.as.query(api.rewards.list, { spaceId });
    expect(list.rewards).toEqual([]);
    expect(list.redemptions).toHaveLength(1); // history survives removal
    expect(await t.run((ctx) => ctx.db.get(rewardId))).toMatchObject({ active: false });
  });
});

describe("spaces.reset", () => {
  it("is owner-only, wipes content, keeps the space + members and audits", async () => {
    const { t, owner, user, spaceId } = await setup();
    await fixtures(t, spaceId);
    const mgr = await user("mgr@acme.com");
    await t.run((ctx) => ctx.db.insert("space_members", { spaceId, userId: mgr.userId, role: "manager" }));
    await expect(mgr.as.mutation(api.spaces.reset, { spaceId })).rejects.toThrow(/403/);

    expect(await owner.as.mutation(api.spaces.reset, { spaceId })).toEqual({ done: true });
    const left = await t.run(async (ctx) => ({
      courses: await ctx.db.query("courses").collect(),
      hires: await ctx.db.query("hires").collect(),
      attempts: await ctx.db.query("attempts").collect(),
      facts: await ctx.db.query("facts").collect(),
      chunks: await ctx.db.query("doc_chunks").collect(),
      members: await ctx.db.query("space_members").collect(),
      audits: await ctx.db.query("audit_events").collect(),
    }));
    expect([left.courses, left.hires, left.attempts, left.facts, left.chunks].map((r) => r.length)).toEqual([0, 0, 0, 0, 0]);
    expect(left.members).toHaveLength(2);
    expect(left.audits.map((a) => a.kind)).toContain("space.reset");
    expect((await owner.as.query(api.spaces.get, { spaceId })).status).toBe("created");
    expect((await owner.as.query(api.dashboard.overview, { spaceId })).kpis.team).toBe(0);
  });

  it("deletes in bounded batches until nothing is left", async () => {
    const { t, spaceId } = await setup();
    await fixtures(t, spaceId);
    const batches: number[] = [];
    for (let done = false; !done; ) {
      const r = await t.run((ctx) => resetBatch(ctx, spaceId, 3));
      expect(r.deleted).toBeLessThanOrEqual(3);
      batches.push(r.deleted);
      done = r.done;
    }
    expect(batches.length).toBeGreaterThan(3);
    expect(await t.run((ctx) => ctx.db.query("facts").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("spaces").collect())).toHaveLength(1);
  });
});
