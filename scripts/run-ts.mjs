// Runs a TypeScript script with .env.local loaded. When an HTTPS proxy is configured (as in some
// CI and sandbox environments) Node fetch is told to use it.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const env = { ...process.env };
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
}
if (env.HTTPS_PROXY || env.https_proxy) {
  env.NODE_USE_ENV_PROXY = "1";
  env.NODE_NO_WARNINGS = "1";
}
const r = spawnSync("npx", ["tsx", ...process.argv.slice(2)], { stdio: "inherit", env });
process.exit(r.status ?? 1);
