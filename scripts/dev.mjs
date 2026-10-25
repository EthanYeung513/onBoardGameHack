// `npm run dev`: the single local entry point (AGENTS.md "Local development").
// 1. Make sure a Convex backend exists — the self-hosted Docker backend in .convex-local (the
//    native `convex dev --local` binary needs a newer glibc than our VMs have), or whatever
//    deployment .env.local already points at.
// 2. Push functions, set Convex Auth keys, copy provider keys into the Convex function env.
// 3. Run `convex dev` (watch) and `next dev` together and print where to go.
// Provider keys are optional: without them every provider runs its labelled offline stand-in.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const envFile = path.join(root, ".env.local");
const compose = path.join(root, ".convex-local", "docker-compose.yml");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const port = process.env.PORT ?? "3000";

/** Provider keys the Convex functions (actions) read. Copied from .env.local when set. */
const FUNCTION_ENV = [
  "MUBIT_API_KEY",
  "MUBIT_BASE_URL",
  "MUBIT_MODEL",
  "MUBIT_EMBED_MODEL",
  "MUBIT_TASK_HEADER",
  "ANTHROPIC_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "GITHUB_CONNECTOR_PAT",
  "NANGO_SECRET_KEY",
  "NANGO_HOST",
  "RESEND_API_KEY",
  "AUTH_RESEND_KEY",
  "FROM_EMAIL",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "OFFLINE",
];

function readEnv() {
  if (!fs.existsSync(envFile)) return {};
  const out = {};
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2].replace(/\s+#.*$/, "");
    if (/^".*"$|^'.*'$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

function upsertEnv(values) {
  let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : fs.readFileSync(path.join(root, ".env.example"), "utf8");
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
  }
  // A self-hosted backend and a cloud deployment can't both be selected.
  if (values.CONVEX_SELF_HOSTED_URL) text = text.replace(/^CONVEX_DEPLOYMENT=.*$/m, "CONVEX_DEPLOYMENT=");
  fs.writeFileSync(envFile, text);
}

const dockerOk = () => spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function ensureBackend() {
  let env = readEnv();
  const selfHosted = env.CONVEX_SELF_HOSTED_URL;
  const cloud = env.CONVEX_DEPLOYMENT;
  if (cloud && !selfHosted) {
    console.log(`convex: using deployment ${cloud}`);
    return env;
  }
  if (selfHosted && !/127\.0\.0\.1|localhost/.test(selfHosted)) return env;
  if (!dockerOk()) {
    if (selfHosted && (await waitFor(`${selfHosted}/version`, 3000))) return env;
    console.error("convex: Docker is not available. Start Docker, or run `npx convex dev --local` / set CONVEX_DEPLOYMENT in .env.local.");
    process.exit(1);
  }
  // The compose file reads PORT for the backend; never let the web port leak into it.
  const composeEnv = { ...process.env, PORT: "3210", SITE_PROXY_PORT: "3211" };
  execFileSync("docker", ["compose", "-f", compose, "up", "-d"], { stdio: "inherit", env: composeEnv });
  if (!(await waitFor("http://127.0.0.1:3210/version"))) {
    console.error("convex: local backend did not become healthy on :3210");
    process.exit(1);
  }
  if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
    const out = execFileSync("docker", ["compose", "-f", compose, "exec", "-T", "backend", "./generate_admin_key.sh"], {
      encoding: "utf8",
      env: composeEnv,
    });
    const key = out.trim().split("\n").pop().trim();
    upsertEnv({
      CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210",
      CONVEX_SELF_HOSTED_ADMIN_KEY: key,
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210",
      NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3211",
    });
    console.log("convex: wrote local backend credentials to .env.local");
    env = readEnv();
  }
  return env;
}

// The deploy key in a CI/agent shell would redirect the CLI to the cloud deployment.
const cliEnv = { ...process.env };
delete cliEnv.CONVEX_DEPLOY_KEY;
delete cliEnv.CONVEX_DEPLOYMENT;

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: cliEnv, cwd: root, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const env = await ensureBackend();
run(npx, ["convex", "dev", "--once"]);
run("node", [path.join(root, "scripts", "convex-auth-keys.mjs")]);
// Idempotent: the demo manager + Acme Pay space exist after every boot.
run(npx, ["convex", "run", "seed:demo"], { stdio: ["ignore", "ignore", "inherit"] });

const fnEnv = FUNCTION_ENV.filter((k) => env[k]).map((k) => `${k}=${JSON.stringify(env[k])}`);
if (fnEnv.length) {
  spawnSync(npx, ["convex", "env", "set", "--force"], { input: fnEnv.join("\n") + "\n", env: cliEnv, cwd: root, stdio: ["pipe", "ignore", "inherit"] });
}
const offline = !env.MUBIT_API_KEY || env.OFFLINE === "1";
console.log(`convex: function env synced (${fnEnv.length} provider vars)${offline ? " — LLM/embeddings run OFFLINE stand-ins" : ""}`);

const children = [
  spawn(npx, ["convex", "dev"], { stdio: ["ignore", "inherit", "inherit"], env: cliEnv, cwd: root }),
  spawn(npx, ["next", "dev", "-p", port], { stdio: "inherit", env: process.env, cwd: root }),
];
console.log(`
  Orthogonal is starting:
    App          http://localhost:${port}            (landing)
    Sign up      http://localhost:${port}/login      (email + password; no keys needed)
    Demo scan    http://localhost:${port}/try        (public constructor)
    Convex       ${env.NEXT_PUBLIC_CONVEX_URL ?? env.CONVEX_DEPLOYMENT}
    Convex UI    http://127.0.0.1:6791               (self-hosted dashboard; admin key in .env.local)
  Demo login:    demo@orthogonal.dev / demo-password   (seeded Acme Pay space)
`);
const stop = () => children.forEach((c) => c.kill("SIGINT"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const c of children) c.on("exit", (code) => { stop(); process.exitCode = code ?? 0; });
