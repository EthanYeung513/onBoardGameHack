import { execFile } from "node:child_process";
import { DEFAULT_TIMEOUT_MS, redact, secretValues, Skip, Warn, type CheckResult, type CheckStatus, type EnvLike, type ExecFn, type Probe, type RunOptions } from "./core";
import { PROBE_GROUPS, SERIAL_PROBES } from "./probes";

export * from "./core";

// `npm run check:env` and the /status page. Each row makes ONE real, cheap, read-only call to a
// provisioned service and reports:
//   pass — the call succeeded
//   fail — a required service is configured but the call failed (exit code 1)
//   warn — an optional service is configured but the call failed
//   skip — not configured, so the app uses its offline stand-in
// Independent groups run in parallel with a per-check timeout; Cloudflare runs alone afterwards
// because its free plan is rate limited. Details are scrubbed of every secret value in the env.
//
// This reads raw process.env names (not src/lib/env.ts) on purpose: a diagnostic has to report
// even when the app's Zod config would refuse to load.

const defaultExec: ExecFn = (cmd, args, { env, signal }) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { env: env as NodeJS.ProcessEnv, signal, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException;
        reject(e.code === "ENOENT" ? Object.assign(new Error(`${cmd} not installed`), { code: "ENOENT" }) : new Error(`${String(stderr || err.message).trim().slice(0, 200)}`));
      } else resolve(String(stdout));
    });
  });

async function runProbe(p: Probe, opts: Required<Pick<RunOptions, "env" | "fetch" | "exec" | "timeoutMs">>, shared: Record<string, string>, secrets: string[]): Promise<CheckResult> {
  const t0 = Date.now();
  const limit = p.timeoutMs ?? opts.timeoutMs;
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(`timed out after ${Math.round(limit / 100) / 10}s`));
    }, limit);
  });
  const base = { name: p.name, optional: p.optional, env: p.env };
  try {
    const detail = await Promise.race([p.run({ env: opts.env, fetch: opts.fetch, exec: opts.exec, signal: ctl.signal, shared }), timeout]);
    return { ...base, status: "pass", ms: Date.now() - t0, detail: redact(detail, secrets) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status: CheckStatus = err instanceof Skip ? "skip" : err instanceof Warn || p.optional ? "warn" : "fail";
    return { ...base, status, ms: Date.now() - t0, detail: redact(msg.slice(0, 300), secrets) };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAllChecks(options: RunOptions = {}): Promise<CheckResult[]> {
  const opts = {
    env: options.env ?? (process.env as EnvLike),
    fetch: options.fetch ?? globalThis.fetch,
    exec: options.exec ?? defaultExec,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  const groups = options.groups ?? PROBE_GROUPS;
  const serial = options.serial ?? SERIAL_PROBES;
  const secrets = secretValues(opts.env);
  const offline = opts.env.OFFLINE === "1";
  const run = async (p: Probe, shared: Record<string, string>): Promise<CheckResult> =>
    offline ? { name: p.name, optional: p.optional, env: p.env, status: "skip", ms: 0, detail: "OFFLINE=1 forces the offline stand-in" } : runProbe(p, opts, shared, secrets);

  const parallel = await Promise.all(
    groups.map(async (group) => {
      const shared: Record<string, string> = {};
      const out: CheckResult[] = [];
      for (const p of group) out.push(await run(p, shared));
      return out;
    }),
  );
  const tail: CheckResult[] = [];
  for (const p of serial) tail.push(await run(p, {}));
  return [...parallel.flat(), ...tail];
}

/** Exit code for the CLI: only required failures fail the run. */
export function exitCode(results: CheckResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export function formatTable(results: CheckResult[]): string {
  const w = Math.max(7, ...results.map((r) => r.name.length));
  const lines = [`${"Service".padEnd(w)}  Result  Time     Detail`];
  for (const r of results) {
    lines.push(`${r.name.padEnd(w)}  ${r.status.toUpperCase().padEnd(6)}  ${`${r.ms}ms`.padEnd(7)}  ${r.detail}`);
  }
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  lines.push("", `${count("pass")} pass, ${count("fail")} fail, ${count("warn")} warn, ${count("skip")} skip (offline stand-in)`);
  return lines.join("\n");
}
