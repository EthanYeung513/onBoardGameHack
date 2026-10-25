import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export type Role = Doc<"space_members">["role"];
export const MANAGERS: Role[] = ["owner", "manager"];

type Ctx = QueryCtx | MutationCtx;

export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) fail(401, "Sign in required");
  return userId;
}

/**
 * Convex has no RLS: every member-only function calls this first. Returns the caller, their
 * membership and the space; 401 when signed out, 404 for a missing space, 403 for a wrong role.
 */
export async function requireRole(ctx: Ctx, spaceId: Id<"spaces">, roles: Role[] = MANAGERS) {
  const userId = await requireUser(ctx);
  const space = await ctx.db.get(spaceId);
  if (!space) fail(404, "Space not found");
  const member = await ctx.db
    .query("space_members")
    .withIndex("by_space_user", (q) => q.eq("spaceId", spaceId).eq("userId", userId))
    .unique();
  if (!member || !roles.includes(member.role)) fail(403, "You don't have access to this space");
  return { userId, member, space };
}

/** F32: every write emits an audit row. */
export async function audit(
  ctx: MutationCtx,
  spaceId: Id<"spaces"> | undefined,
  actor: string,
  kind: string,
  payload?: Record<string, unknown>,
) {
  await ctx.db.insert("audit_events", { spaceId, actor, kind, payload });
}
