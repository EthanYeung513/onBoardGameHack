// `npm run dev`: the single local entry point (AGENTS.md "Local development").
// 1. Make sure a Convex backend exists — the self-hosted Docker backend in .convex-local (the
//    native `convex dev --local` binary needs a newer glibc than our VMs have), or whatever
//    deployment .env.local already points at.
// 2. Push functions, set Convex Auth keys, copy provider keys into the Convex function env.
// 3. Run `convex dev` (watch) and `next dev` together and print where to go.
// Provider keys are optional: without them every provider runs its labelled offline stand-in.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  // Brand-learning loop (convex/brandLoop.ts): feedback endpoint + Mubit memory switch.
  "MUBIT_FEEDBACK_URL",
  "MUBIT_ENDPOINT",
  "MEMORY_PROVIDER",
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
  "WORKER_SECRET",
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
  for (const [k, raw] of Object.entries(values)) {
    // Quote anything a shell would split or interpret (the admin key contains "|"), so
    // `set -a; source .env.local` keeps working.
    const v = /^[A-Za-z0-9_./:@-]*$/.test(raw) ? raw : `"${String(raw).replace(/(["\\$`])/g, "\\$1")}"`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, () => `${k}=${v}`) : `${text.replace(/\n?$/, "\n")}${k}=${v}\n`;
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
  // One Docker backend per CONVEX_LOCAL_PORT (default 3210), so parallel checkouts don't push
  // over each other's functions. The compose file reads PORT; never let the web port leak into it.
  const cport = Number(process.env.CONVEX_LOCAL_PORT ?? 3210);
  const project = cport === 3210 ? "convex-local" : `convex-${cport}`;
  const backendUrl = `http://127.0.0.1:${cport}`;
  const composeEnv = {
    ...process.env,
    PORT: String(cport),
    SITE_PROXY_PORT: String(cport + 1),
    DASHBOARD_PORT: cport === 3210 ? "6791" : String(cport + 2),
    // Convex Auth validates tokens by fetching JWKS from its own site origin *inside* the
    // container, where the HTTP-actions proxy always listens on 3211 — a host port would hang
    // sign-in on any non-default CONVEX_LOCAL_PORT.
    CONVEX_SITE_ORIGIN: "http://127.0.0.1:3211",
  };
  const dc = (...args) => ["compose", "-p", project, "-f", compose, ...args];
  execFileSync("docker", dc("up", "-d"), { stdio: "inherit", env: composeEnv });
  if (!(await waitFor(`${backendUrl}/version`))) {
    console.error(`convex: local backend did not become healthy on :${cport}`);
    process.exit(1);
  }
  if (!env.CONVEX_SELF_HOSTED_ADMIN_KEY || env.CONVEX_SELF_HOSTED_URL !== backendUrl) {
    const out = execFileSync("docker", dc("exec", "-T", "backend", "./generate_admin_key.sh"), { encoding: "utf8", env: composeEnv });
    const key = out.trim().split("\n").pop().trim();
    upsertEnv({
      CONVEX_SELF_HOSTED_URL: backendUrl,
      CONVEX_SELF_HOSTED_ADMIN_KEY: key,
      NEXT_PUBLIC_CONVEX_URL: backendUrl,
      NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${cport + 1}`,
    });
    console.log(`convex: wrote local backend (${project}) credentials to .env.local`);
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

let env = await ensureBackend();
// Shared secret between the Convex functions and the pipeline worker (convex/lib/worker.ts).
if (!env.WORKER_SECRET) {
  upsertEnv({ WORKER_SECRET: randomBytes(24).toString("hex") });
  env = readEnv();
}
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

// Workers left over from an earlier run of this checkout (a killed parent used to orphan them)
// would keep claiming jobs with stale code — stop them first. Only this checkout's processes.
for (const pid of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d) && Number(d) !== process.pid)) {
  try {
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (cmd.includes("src/worker/main.ts") && fs.realpathSync(`/proc/${pid}/cwd`) === fs.realpathSync(root)) {
      process.kill(Number(pid), "SIGTERM");
      console.log(`dev: stopped a stale worker from an earlier run (pid ${pid})`);
    }
  } catch {}
}

// Each child runs in its own process group so stopping dev stops grandchildren (tsx, next) too.
const group = { detached: true };
const children = [
  spawn(npx, ["convex", "dev"], { stdio: ["ignore", "inherit", "inherit"], env: cliEnv, cwd: root, ...group }),
  spawn(npx, ["next", "dev", "-p", port], { stdio: "inherit", env: process.env, cwd: root, ...group }),
];
// The pipeline worker (scan stages, connector syncs, the drift cascade) — on Modal in production.
// dembrandt (rendered-page brand extraction) runs on the worker's local Chromium; DEMBRANDT_ENABLED=0 opts out.
// Supervised: if it exits it is restarted with backoff, so scans never wait on a dead worker.
const startWorker = () => spawn("node", [path.join(root, "scripts", "run-ts.mjs"), "src/worker/main.ts"], { stdio: "inherit", env: { DEMBRANDT_ENABLED: "true", ...cliEnv }, cwd: root, ...group });
let worker = startWorker();
let workerRestarts = 0;
const superviseWorker = () =>
  worker.on("exit", (code, signal) => {
    if (stopping) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(workerRestarts++, 5));
    console.error(`dev: pipeline worker exited (${signal ?? `code ${code}`}) — restarting in ${delay / 1000}s`);
    setTimeout(() => {
      if (stopping) return;
      worker = startWorker();
      superviseWorker();
    }, delay);
  });
superviseWorker();
console.log(`
  Orthogonal is starting:
    App          http://localhost:${port}            (landing)
    Sign up      http://localhost:${port}/login      (email + password; no keys needed)
    Convex       ${env.NEXT_PUBLIC_CONVEX_URL ?? env.CONVEX_DEPLOYMENT}
    Convex UI    http://127.0.0.1:${process.env.CONVEX_LOCAL_PORT ? Number(process.env.CONVEX_LOCAL_PORT) + 2 : 6791}               (self-hosted dashboard; admin key in .env.local)
  Worker         pipeline jobs (${offline ? "LLM/embeddings OFFLINE — labelled stand-ins" : "Mubit live"})
  Demo login:    demo@orthogonal.dev / demo-password   (seeded Acme Pay space)
`);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of [...children, worker]) {
    try {
      process.kill(-c.pid, "SIGINT");
    } catch {}
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
// Convex or Next exiting ends the dev session (e.g. the web port is taken) — loudly, never half-up.
for (const c of children) c.on("exit", (code) => { if (!stopping) console.error(`dev: ${c.spawnargs.slice(1, 3).join(" ")} exited (code ${code}) — stopping`); stop(); process.exitCode = code ?? 0; });
