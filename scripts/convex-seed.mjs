// `npm run db:seed`: seeds the demo manager + Acme Pay space into the Convex deployment in .env.local.
import { spawnSync } from "node:child_process";

const env = { ...process.env };
delete env.CONVEX_DEPLOY_KEY;
delete env.CONVEX_DEPLOYMENT;
const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["convex", "run", "seed:demo"], { stdio: "inherit", env });
if (r.status === 0) console.log("Seeded. Log in at /login as demo@orthogonal.dev / demo-password");
process.exit(r.status ?? 1);
