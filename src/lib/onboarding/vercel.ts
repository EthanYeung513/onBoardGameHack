// Create-or-update one Vercel project per company (D-33): every Generate re-deploys the same
// project name to production, so the company keeps one stable URL.

export interface VercelConfig {
  token: string;
  teamId?: string;
}

export function vercelConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VercelConfig | null {
  const token = env.VERCEL_TOKEN_FULL || env.VERCEL_TOKEN;
  if (!token || env.OFFLINE === "1") return null;
  return { token, teamId: env.VERCEL_TEAM_ID || undefined };
}

/** Vercel project names: lowercase, ≤100 chars, [a-z0-9._-]. */
export function projectNameFor(slug: string): string {
  return `orthogonal-${slug}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 90);
}

type Fetch = typeof fetch;

async function call<T>(cfg: VercelConfig, method: string, url: string, body?: unknown, fetchImpl: Fetch = fetch): Promise<T> {
  const u = new URL(`https://api.vercel.com${url}`);
  if (cfg.teamId) u.searchParams.set("teamId", cfg.teamId);
  const res = await fetchImpl(u, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) throw new Error(`Vercel ${method} ${url} → ${res.status}: ${json.error?.message ?? json.error?.code ?? "request failed"}`);
  return json;
}

export interface DeployResult {
  url: string;
  projectId: string;
  deploymentId: string;
}

export async function deployStatic(
  cfg: VercelConfig,
  opts: { projectName: string; files: { file: string; data: string }[]; onEvent?: (msg: string) => Promise<void> | void; timeoutMs?: number },
  fetchImpl: Fetch = fetch,
): Promise<DeployResult> {
  type Deployment = { id: string; url: string; readyState?: string; projectId?: string; alias?: string[]; errorMessage?: string };
  let d = await call<Deployment>(
    cfg,
    "POST",
    "/v13/deployments?skipAutoDetectionConfirmation=1",
    {
      name: opts.projectName,
      project: opts.projectName,
      target: "production",
      files: opts.files.map((f) => ({ file: f.file, data: f.data })),
      projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null },
    },
    fetchImpl,
  );
  await opts.onEvent?.(`Vercel deployment ${d.id} created (${d.readyState ?? "QUEUED"})`);
  const until = Date.now() + (opts.timeoutMs ?? 120_000);
  while (d.readyState !== "READY") {
    if (d.readyState === "ERROR" || d.readyState === "CANCELED") throw new Error(`Vercel deployment ${d.readyState}: ${d.errorMessage ?? "see Vercel dashboard"}`);
    if (Date.now() > until) throw new Error("Vercel deployment did not become ready in time");
    await new Promise((r) => setTimeout(r, 2500));
    d = await call<Deployment>(cfg, "GET", `/v13/deployments/${d.id}`, undefined, fetchImpl);
  }
  // Production alias `<project>.vercel.app` when Vercel assigned it; else the deployment URL.
  const alias = d.alias?.find((a) => a.startsWith(`${opts.projectName}`)) ?? d.alias?.[0];
  return { url: `https://${alias ?? d.url}`, projectId: d.projectId ?? opts.projectName, deploymentId: d.id };
}
