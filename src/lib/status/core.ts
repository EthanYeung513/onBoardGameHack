// Shared types and helpers for the service checks (see checks.ts).

export type CheckStatus = "pass" | "fail" | "warn" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  ms: number;
  detail: string;
  /** Optional services report a failure as `warn` and never fail the run. */
  optional?: boolean;
  /** Env vars this row reads (names only). */
  env: string[];
}

export type EnvLike = Record<string, string | undefined>;
export type ExecFn = (cmd: string, args: string[], opts: { env: EnvLike; signal: AbortSignal }) => Promise<string>;

export interface ProbeCtx {
  env: EnvLike;
  fetch: typeof fetch;
  exec: ExecFn;
  signal: AbortSignal;
  /** Values passed between probes of the same group (e.g. the Mubit model picked from /models). */
  shared: Record<string, string>;
}

export interface Probe {
  name: string;
  env: string[];
  optional?: boolean;
  timeoutMs?: number;
  run(ctx: ProbeCtx): Promise<string>;
}

/** Thrown by a probe to report `skip` (not configured → offline stand-in). */
export class Skip extends Error {}

/** Thrown by a probe to report `warn` even for a required service (e.g. rate limited, key accepted). */
export class Warn extends Error {}

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunOptions {
  env?: EnvLike;
  fetch?: typeof fetch;
  exec?: ExecFn;
  timeoutMs?: number;
  groups?: Probe[][];
  serial?: Probe[];
}

/** First non-empty value among alternate names. */
export function pick(env: EnvLike, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
}

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|DSN|PAT\b|_PAT$/;

/** Every secret-looking env value (and URL credentials inside them), longest first. */
export function secretValues(env: EnvLike): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 6 || !SECRET_NAME.test(name)) continue;
    out.add(value);
    try {
      const u = new URL(value);
      if (u.username.length >= 6) out.add(u.username);
      if (u.password.length >= 6) out.add(u.password);
    } catch {
      /* not a URL */
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function redact(text: string, secrets: string[]): string {
  let s = text;
  for (const v of secrets) s = s.split(v).join("***");
  return s;
}
