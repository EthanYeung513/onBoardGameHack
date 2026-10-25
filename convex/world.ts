import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { audit } from "./lib/access";
import { fail } from "./lib/errors";
import { CAP } from "./lib/progress";

// The hire's world (/o/<slug>) reporting back to the manager's dashboard. Public on purpose: the
// world is the link the manager shares and hires sign in there with just a name and work email.
// Both mutations are keyed by the published space's slug, validate their input, cap what one
// caller can create, and return nothing about other hires (no ids, no lists).
//
//  - hireJoined: the hire signed in. Upserts their `hires` row by email (an invited hire becomes
//    "onboarding"; an open invite for that email is marked accepted).
//  - hireProgress: a building's game finished. A cleared run is the course's `done` attempt (the
//    course counts as complete, its reward is added to the hire's coins once); an uncleared run
//    keeps the hire's best accuracy on the course as an in-progress attempt.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Matches the world's default course reward (world/src/economy.ts DEFAULT_COURSE_REWARD). */
export const WORLD_COURSE_REWARD = 50;
/** An uncleared run is stored on an unscored step, so it shows activity without completing the course. */
const IN_PROGRESS_STEP = "welcome";

async function publishedSpace(ctx: MutationCtx, slug: string) {
  const space = await ctx.db
    .query("spaces")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .first();
  if (!space || !space.deployedAt) fail(404, "This onboarding world isn't published.");
  return space;
}

function cleanEmail(email: string) {
  const clean = email.trim().toLowerCase();
  if (clean.length > 200 || !EMAIL.test(clean)) fail(422, "Enter a valid work email.");
  return clean;
}

const cleanName = (name: string | undefined) => name?.trim().replace(/\s+/g, " ").slice(0, 80) || undefined;

async function upsertHire(ctx: MutationCtx, spaceId: Id<"spaces">, email: string, name: string | undefined) {
  const existing = await ctx.db
    .query("hires")
    .withIndex("by_space_email", (q) => q.eq("spaceId", spaceId).eq("email", email))
    .unique();
  const now = Date.now();
  if (existing) {
    const patch: Partial<Doc<"hires">> = {};
    if (existing.status === "invited") patch.status = "onboarding";
    if (!existing.joinedAt) patch.joinedAt = now;
    if (!existing.name && name) patch.name = name;
    if (Object.keys(patch).length) await ctx.db.patch(existing._id, patch);
    return { hire: { ...existing, ...patch }, created: false };
  }
  // A public endpoint can't grow a space without bound: past the dashboard's cap, no new hires.
  const count = (await ctx.db.query("hires").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.hires)).length;
  if (count >= CAP.hires) fail(409, "This space has reached its hire limit. Ask your manager.");
  const hireId = await ctx.db.insert("hires", { spaceId, email, name, status: "onboarding", joinedAt: now, coins: 0 });
  return { hire: (await ctx.db.get(hireId))!, created: true };
}

async function acceptInvite(ctx: MutationCtx, spaceId: Id<"spaces">, email: string) {
  const invites = await ctx.db.query("hire_invites").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(1000);
  const open = invites.find((i) => i.email === email && !i.acceptedAt);
  if (open) await ctx.db.patch(open._id, { acceptedAt: Date.now() });
  return Boolean(open);
}

export const hireJoined = mutation({
  args: { slug: v.string(), email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const space = await publishedSpace(ctx, args.slug);
    const email = cleanEmail(args.email);
    const { hire, created } = await upsertHire(ctx, space._id, email, cleanName(args.name));
    const invited = await acceptInvite(ctx, space._id, email);
    if (created || invited) await audit(ctx, space._id, `hire:${hire._id}`, "hire.joined", { hireId: hire._id, via: "world", invited });
    return { ok: true as const };
  },
});

export const hireProgress = mutation({
  args: {
    slug: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    /** The world's course id: the course's pack type (src/lib/world/build.ts). */
    course: v.string(),
    won: v.boolean(),
    correct: v.number(),
    total: v.number(),
  },
  handler: async (ctx, args) => {
    const space = await publishedSpace(ctx, args.slug);
    const email = cleanEmail(args.email);
    const course = (
      await ctx.db
        .query("courses")
        .withIndex("by_space_pack", (q) => q.eq("spaceId", space._id).eq("packType", args.course.slice(0, 80)))
        .take(5)
    ).find((c) => c.status !== "archived");
    if (!course) fail(404, "That course isn't in this world.");

    const { hire } = await upsertHire(ctx, space._id, email, cleanName(args.name));
    const total = Math.max(0, Math.min(1000, Math.floor(args.total)));
    const correct = Math.max(0, Math.min(total, Math.floor(args.correct)));
    const score = total ? Math.round((correct / total) * 100) : args.won ? 100 : 0;
    const result = { source: "world", won: args.won, correct, total };

    const mine = (await ctx.db.query("attempts").withIndex("by_hire", (q) => q.eq("hireId", hire._id)).take(CAP.attempts)).filter(
      (a) => a.courseId === course._id,
    );
    const done = mine.find((a) => a.stepId === "done");
    let completed = false;
    if (args.won && !done) {
      await ctx.db.insert("attempts", { spaceId: space._id, hireId: hire._id, courseId: course._id, stepId: "done", result, score });
      await ctx.db.patch(hire._id, { coins: hire.coins + WORLD_COURSE_REWARD });
      completed = true;
    } else if (!args.won) {
      // One in-progress attempt per hire and course, holding their best run: replays can't pile up rows.
      const open = mine.find((a) => a.stepId === IN_PROGRESS_STEP);
      if (!open) await ctx.db.insert("attempts", { spaceId: space._id, hireId: hire._id, courseId: course._id, stepId: IN_PROGRESS_STEP, result, score });
      else if (score > open.score) await ctx.db.patch(open._id, { result, score });
    }

    if (completed) {
      await audit(ctx, space._id, `hire:${hire._id}`, "hire.course_completed", { hireId: hire._id, courseId: course._id, score });
      await markCompleteIfAllDone(ctx, space._id, hire._id);
    }
    return { ok: true as const, completed };
  },
});

/** Every live course cleared: the hire's onboarding is complete. */
async function markCompleteIfAllDone(ctx: MutationCtx, spaceId: Id<"spaces">, hireId: Id<"hires">) {
  const courses = (await ctx.db.query("courses").withIndex("by_space", (q) => q.eq("spaceId", spaceId)).take(CAP.courses)).filter(
    (c) => c.status !== "archived",
  );
  const attempts = await ctx.db.query("attempts").withIndex("by_hire", (q) => q.eq("hireId", hireId)).take(CAP.attempts);
  const done = new Set(attempts.filter((a) => a.stepId === "done").map((a) => a.courseId));
  if (courses.length && courses.every((c) => done.has(c._id))) await ctx.db.patch(hireId, { status: "complete" });
}
