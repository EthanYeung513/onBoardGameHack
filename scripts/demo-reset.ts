// Usage: npm run demo:reset -- [--url http://localhost:3000] [--key <DEMO_RESET_KEY>]
// Restores the seeded Acme Pay state. If the app is running it resets through the server (PGlite is
// single-process, so the server must do it); otherwise it resets the database directly.
import { parseArgs } from "node:util";
import { closeDb, getDb } from "../src/db/client";
import { resetDemo } from "../src/services/demo";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    key: { type: "string", default: process.env.DEMO_RESET_KEY ?? "" },
  },
});

let running = false;
try {
  const res = await fetch(`${values.url}/api/admin/reset`, { method: "POST", headers: values.key ? { "x-demo-reset-key": values.key } : {} });
  running = true;
  if (!res.ok) throw new Error(`${res.status}: ${(await res.json().catch(() => ({}))).error ?? "reset failed"}`);
  console.log(`Reset through the running app at ${values.url}.`);
} catch (err) {
  if (running) {
    console.error(`Reset failed: ${(err as Error).message}`);
    process.exit(1);
  }
  await resetDemo(await getDb());
  console.log("No app running: reset the database directly.");
}
await closeDb();
process.exit(0);
