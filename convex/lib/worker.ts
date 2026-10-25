import { customAction, customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import { action, mutation, query } from "../_generated/server";
import { fail } from "./errors";

// The pipeline worker (src/worker, Node — locally via `npm run dev`, in production on Modal) talks
// to Convex through these builders. Every call carries WORKER_SECRET, which is set in the Convex
// function env and the worker env; managers can never call them.

function assertWorker(secret: string) {
  const expected = process.env.WORKER_SECRET;
  if (!expected) fail(503, "WORKER_SECRET is not set on this deployment");
  let diff = secret.length ^ expected.length;
  for (let i = 0; i < Math.max(secret.length, expected.length); i++) diff |= (secret.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  if (diff !== 0) fail(401, "Bad worker secret");
}

const workerArgs = {
  args: { secret: v.string() },
  input: async (_ctx: unknown, { secret }: { secret: string }) => {
    assertWorker(secret);
    return { ctx: {}, args: {} };
  },
};

export const workerQuery = customQuery(query, workerArgs);
export const workerMutation = customMutation(mutation, workerArgs);
/** Worker actions: only for what queries/mutations can't do (vector search). */
export const workerAction = customAction(action, workerArgs);
