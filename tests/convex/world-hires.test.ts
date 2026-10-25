// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "@convex/_generated/api";
import schema from "@convex/schema";

const modules = import.meta.glob(["../../convex/**/*.ts", "../../convex/**/*.js", "!../../convex/**/*.d.ts"]);

const step = (kind: string, title: string) => ({ kind, title, teaches_fact_ids: [] });

async function setup({ published = true } = {}) {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "dana@acme.com" }));
  const owner = t.withIdentity({ subject: `${userId}|session` });
  const { spaceId, slug } = await owner.mutation(api.spaces.create, { name: "Acme", website: "acme.com" });
  await t.run(async (ctx) => {
    if (published) await ctx.db.patch(spaceId, { deployedAt: Date.now() });
    const spec = { steps: [step("welcome", "Hi"), step("lesson", "Origin"), step("quiz", "Glossary"), step("done", "Bye")] };
    const base = { spaceId, icon: "landmark", building: "HQ Hall", game: "quiz" as const, spec, status: "published" as const, version: 1, needsRefresh: false };
    await ctx.db.insert("courses", { ...base, packType: "company", title: "Company 101" });
    await ctx.db.insert("courses", { ...base, packType: "tools-stack", title: "Tools & Stack" });
  });
  return { t, owner, spaceId, slug };
}

describe("the world reports hires to the dashboard", () => {
  it("registers each email as its own hire, honouring an existing invite, and never duplicates", async () => {
    const { t, owner, spaceId, slug } = await setup();
    const { token } = await owner.mutation(api.hires.invite, { spaceId, email: "b@x.com" });

    expect(await t.mutation(api.world.hireJoined, { slug, email: " A@X.com ", name: "Ada" })).toEqual({ ok: true });
    await t.mutation(api.world.hireJoined, { slug, email: "a@x.com", name: "Someone else" });
    await t.mutation(api.world.hireJoined, { slug, email: "b@x.com", name: "Bo" });

    const o = await owner.query(api.dashboard.overview, { spaceId });
    expect(o.hires.map((h) => [h.email, h.name, h.status])).toEqual([
      ["b@x.com", "Bo", "onboarding"], // the invited row, now playing
      ["a@x.com", "Ada", "onboarding"], // first name kept
    ]);
    const invite = await t.run((ctx) => ctx.db.query("hire_invites").withIndex("by_token", (q) => q.eq("token", token)).unique());
    expect(invite?.acceptedAt).toBeTypeOf("number");
  });

  it("moves progress, completion and coins from finished games", async () => {
    const { t, owner, spaceId, slug } = await setup();
    const report = (course: string, won: boolean, correct: number, total = 4) =>
      t.mutation(api.world.hireProgress, { slug, email: "a@x.com", name: "Ada", course, won, correct, total });

    expect(await report("company", false, 2)).toEqual({ ok: true, completed: false }); // also registers the hire
    await report("company", false, 3); // best run kept, no new row
    let [row] = (await owner.query(api.dashboard.overview, { spaceId })).hires;
    expect(row).toMatchObject({ email: "a@x.com", progress: 0, coursesDone: 0, started: 1, coins: 0 });

    expect(await report("company", true, 4)).toEqual({ ok: true, completed: true });
    expect(await report("company", true, 4)).toEqual({ ok: true, completed: false }); // replay pays nothing more
    [row] = (await owner.query(api.dashboard.overview, { spaceId })).hires;
    expect(row).toMatchObject({ progress: 50, coursesDone: 1, coins: 50, status: "onboarding" });

    await report("tools-stack", true, 3);
    [row] = (await owner.query(api.dashboard.overview, { spaceId })).hires;
    expect(row).toMatchObject({ progress: 100, coursesDone: 2, coins: 100, status: "complete" });
    const analytics = await owner.query(api.dashboard.analytics, { spaceId });
    expect(analytics.courses.map((c) => c.completion)).toEqual([100, 100]);
    expect(await t.run((ctx) => ctx.db.query("attempts").collect())).toHaveLength(3);
  });

  it("rejects bad input and unpublished worlds without exposing anything", async () => {
    const { t, slug } = await setup();
    await expect(t.mutation(api.world.hireJoined, { slug, email: "not-an-email" })).rejects.toThrow(/valid work email/);
    await expect(t.mutation(api.world.hireJoined, { slug: "nope", email: "a@x.com" })).rejects.toThrow(/isn't published/);
    await expect(
      t.mutation(api.world.hireProgress, { slug, email: "a@x.com", course: "unknown", won: true, correct: 1, total: 1 }),
    ).rejects.toThrow(/isn't in this world/);

    const draft = await setup({ published: false });
    await expect(draft.t.mutation(api.world.hireJoined, { slug: draft.slug, email: "a@x.com" })).rejects.toThrow(/isn't published/);
    expect(await draft.t.run((ctx) => ctx.db.query("hires").collect())).toEqual([]);
  });
});
