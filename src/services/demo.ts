import path from "node:path";
import { acmePay } from "../../content/acme-pay/world";
import type { DB } from "../db/client";
import { resetDb, seedWorld } from "../db/seed";
import { defaultModel } from "../llm/env";

/** Wipes everything and re-seeds Acme Pay: the known starting state for every rehearsal and the demo. */
export async function resetDemo(db: DB) {
  await resetDb(db);
  return seedWorld(db, acmePay, path.join(process.cwd(), "content", "acme-pay"), defaultModel());
}

/**
 * Resets are allowed in development, or anywhere with the right DEMO_RESET_KEY. A deployed demo without a key
 * refuses, so a stranger can't wipe it.
 */
export function resetAllowed(env: NodeJS.ProcessEnv, providedKey: string | null): boolean {
  if (env.DEMO_RESET_KEY) return providedKey === env.DEMO_RESET_KEY;
  return env.NODE_ENV !== "production";
}
