import { z } from "zod";
import { EMBEDDING_DIMS } from "@convex/schema";
import { mubitConfigFromEnv } from "@/llm/env";
import { DEFAULT_MUBIT_MODEL, MubitClient, type MubitConfig } from "@/llm/mubit";
import { probeMubitMemory } from "@/lib/memory/mubit-provider";
import { pick, Skip, Warn, type Probe, type ProbeCtx } from "./core";

// One probe per row; each makes ONE real, cheap, read-only call. See docs/PROVISIONING.md
// "Verify with check:env" for the row → env → probe table.

async function getJson(ctx: ProbeCtx, url: string, init: RequestInit = {}): Promise<{ res: Response; json: Record<string, unknown> | null }> {
  const res = await ctx.fetch(url, { ...init, signal: ctx.signal });
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { res, json };
}

function httpError(service: string, res: Response, json: Record<string, unknown> | null): Error {
  const err = json?.error as { message?: string } | string | undefined;
  const msg = (typeof err === "string" ? err : err?.message) ?? (json?.message as string | undefined) ?? "";
  return new Error(`${service} HTTP ${res.status}${msg ? `: ${String(msg).slice(0, 160)}` : ""}`);
}

/** The app's own Mubit config (src/llm/env.ts) for this env; SKIP when no key is set. */
function mubitConfig(ctx: ProbeCtx): MubitConfig {
  const config = mubitConfigFromEnv(ctx.env as NodeJS.ProcessEnv);
  if (!config) throw new Skip("MUBIT_API_KEY not set — offline stand-ins (rule-based LLM, hashed embeddings)");
  return config;
}

/**
 * THE Mubit adapter (src/llm/mubit.ts), built exactly as the app builds it — its own transport
 * (global fetch), so the row proves the real call path. The runner's timeout still bounds it.
 */
function mubitClient(config: MubitConfig): MubitClient {
  return new MubitClient(config);
}

const mubitModels: Probe = {
  name: "Mubit models",
  env: ["MUBIT_API_KEY", "MUBIT_BASE_URL", "MUBIT_MODEL"],
  async run(ctx) {
    const { apiKey, baseURL } = mubitConfig(ctx);
    const { res, json } = await getJson(ctx, `${baseURL.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw httpError("Mubit /models", res, json);
    const ids = ((json?.data as Array<{ id: string }>) ?? []).map((m) => m.id);
    const configured = pick(ctx.env, "MUBIT_MODEL");
    if (configured && !ids.includes(configured)) throw new Error(`MUBIT_MODEL=${configured} is not in the ${ids.length} served models`);
    const gpt = ids.filter((id) => id.startsWith("gpt-"));
    const chosen = configured ?? (ids.includes(DEFAULT_MUBIT_MODEL) ? DEFAULT_MUBIT_MODEL : (gpt.find((id) => id.includes("mini")) ?? gpt[0]));
    if (!chosen) throw new Error(`no gpt-* chat model among ${ids.length} served models`);
    ctx.shared.model = chosen;
    const embeds = ids.filter((id) => id.startsWith("text-embedding")).length;
    return `${ids.length} models (${gpt.length} gpt-*, ${embeds} embedding); ${configured ? `MUBIT_MODEL=${chosen}` : `MUBIT_MODEL unset → using ${chosen}`}`;
  },
};

const mubitChat: Probe = {
  name: "Mubit chat (JSON)",
  env: ["MUBIT_API_KEY", "MUBIT_MODEL", "MUBIT_TASK_HEADER"],
  async run(ctx) {
    const config = mubitConfig(ctx);
    const r = await mubitClient(config).json({
      task: "env-check",
      system: "You are a health check. Reply with JSON only.",
      user: 'Return {"ok": true}',
      schema: z.object({ ok: z.literal(true) }),
      model: ctx.shared.model ?? config.model,
      retries: 0,
    });
    return `${r.model} via MubitClient.json, task=env-check${r.requestId ? ", request id returned" : ""}`;
  },
};

const mubitEmbed: Probe = {
  name: "Mubit embeddings",
  env: ["MUBIT_API_KEY", "MUBIT_EMBED_MODEL"],
  async run(ctx) {
    const config = mubitConfig(ctx);
    if (!config.embedModel) throw new Skip("MUBIT_EMBED_MODEL=off — hashed embedding stand-in");
    const [v] = await mubitClient(config).embed(["env check"], { dimensions: EMBEDDING_DIMS });
    if (v?.length !== EMBEDDING_DIMS) throw new Error(`embedding width ${v?.length ?? 0} ≠ ${EMBEDDING_DIMS}`);
    return `${config.embedModel}, ${v.length} dims via MubitClient.embed`;
  },
};

const mubitMemory: Probe = {
  name: "Mubit memory",
  env: ["MUBIT_API_KEY", "MUBIT_ENDPOINT", "MEMORY_PROVIDER"],
  optional: true,
  async run(ctx) {
    mubitConfig(ctx);
    const r = await probeMubitMemory();
    const using = pick(ctx.env, "MEMORY_PROVIDER") === "mubit" ? "MEMORY_PROVIDER=mubit" : "app uses the Convex memory store";
    const code = r.error?.match(/"code"\s*:\s*"([^"]+)"/)?.[1];
    if (!r.ok) throw new Error(`remember+recall failed — ${code ? `${code} (memory API not served at MUBIT_ENDPOINT for this key)` : (r.error ?? "unknown error").slice(0, 160)}; ${using}`);
    return `remember + recall ok (${using})`;
  },
};

const mubitFeedback: Probe = {
  name: "Mubit feedback endpoint",
  env: ["MUBIT_FEEDBACK_URL", "MUBIT_API_KEY"],
  optional: true,
  async run(ctx) {
    const raw = pick(ctx.env, "MUBIT_FEEDBACK_URL");
    if (!raw) throw new Skip("MUBIT_FEEDBACK_URL not set — corrections use the distil fallback");
    const { apiKey, baseURL } = mubitConfig(ctx);
    const url = /^https?:\/\//.test(raw) ? raw : `${baseURL.replace(/\/$/, "")}/${raw.replace(/^\//, "")}`;
    // GET only: posting a fake correction would pollute Mubit's training signal.
    const res = await ctx.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: ctx.signal });
    if (res.status === 401 || res.status === 403) throw new Error(`HTTP ${res.status} — key rejected`);
    if (res.status === 404 || res.status >= 500) throw new Error(`HTTP ${res.status} — endpoint not available`);
    return `reachable (HTTP ${res.status} to GET; no feedback sent)`;
  },
};

function convexUrl(env: ProbeCtx["env"]): { url: string; mode: string } | null {
  const selfHosted = pick(env, "CONVEX_SELF_HOSTED_URL");
  // CONVEX_URL: the deployment the worker polls (production: the cloud deployment).
  const pub = pick(env, "CONVEX_URL") ?? pick(env, "NEXT_PUBLIC_CONVEX_URL");
  const deployment = pick(env, "CONVEX_DEPLOYMENT");
  const url = pub ?? selfHosted ?? (deployment ? `https://${deployment.replace(/^[a-z]+:/, "").split("|")[0]}.convex.cloud` : undefined);
  if (!url) return null;
  const mode = selfHosted || !/\.convex\.cloud/.test(url) ? "self-hosted" : "cloud";
  return { url, mode };
}

const convex: Probe = {
  name: "Convex",
  env: ["CONVEX_URL", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_SELF_HOSTED_URL", "CONVEX_DEPLOYMENT"],
  async run(ctx) {
    const c = convexUrl(ctx.env);
    if (!c) throw new Skip("no Convex URL — `npm run dev` boots the local backend and writes .env.local");
    const res = await ctx.fetch(`${c.url.replace(/\/$/, "")}/version`, { signal: ctx.signal });
    const text = (await res.text()).trim();
    if (!res.ok) throw new Error(`/version HTTP ${res.status}`);
    return `${c.mode} ${new URL(c.url).host}, /version → ${text.slice(0, 40) || "ok"}`;
  },
};

const github: Probe = {
  name: "GitHub connector",
  env: ["GITHUB_CONNECTOR_PAT"],
  async run(ctx) {
    const token = pick(ctx.env, "GITHUB_CONNECTOR_PAT");
    if (!token) throw new Skip("GITHUB_CONNECTOR_PAT not set — GitHub connector shows its not-connected state");
    const { res, json } = await getJson(ctx, "https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "orthogonal-check-env" } });
    if (!res.ok) throw httpError("GitHub /user", res, json);
    return `@${json?.login}, rate limit ${res.headers.get("x-ratelimit-remaining") ?? "?"} remaining`;
  },
};

export const NANGO_CONNECTORS = ["slack", "jira", "notion", "google-drive", "github"] as const;

const nango: Probe = {
  name: "Nango",
  env: ["NANGO_SECRET_KEY", "NANGO_HOST"],
  async run(ctx) {
    const key = pick(ctx.env, "NANGO_SECRET_KEY");
    if (!key) throw new Skip("NANGO_SECRET_KEY not set — Slack/Jira/Notion/Drive connectors stay not-connected");
    const host = (pick(ctx.env, "NANGO_HOST") ?? "https://api.nango.dev").replace(/\/$/, "");
    const { res, json } = await getJson(ctx, `${host}/integrations`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw httpError("Nango /integrations", res, json);
    const providers = ((json?.data as Array<{ provider?: string }>) ?? []).map((i) => i.provider ?? "");
    const live = NANGO_CONNECTORS.filter((c) => providers.some((p) => p === c || p.startsWith(`${c}-`)));
    const missing = NANGO_CONNECTORS.filter((c) => !live.includes(c));
    return `${providers.length} integrations; connectors configured: ${live.join(", ") || "none"}; not configured: ${missing.join(", ") || "none"}`;
  },
};

const resend: Probe = {
  name: "Resend",
  env: ["RESEND_API_KEY", "AUTH_RESEND_KEY"],
  async run(ctx) {
    const key = pick(ctx.env, "RESEND_API_KEY", "AUTH_RESEND_KEY");
    if (!key) throw new Skip("RESEND_API_KEY not set — invites/magic links unavailable (email+password only)");
    const { res, json } = await getJson(ctx, "https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` } });
    // A send-only key is valid but may not list domains; an invalid key is a 400 validation_error.
    if (res.status === 401 && json?.name === "restricted_api_key") return "send-only key accepted (domains not readable); no mail sent";
    if (!res.ok) throw httpError("Resend /domains", res, json);
    const domains = (json?.data as Array<{ name: string; status: string }>) ?? [];
    return `${domains.length} domains${domains.length ? `: ${domains.map((d) => `${d.name} (${d.status})`).join(", ")}` : " (onboarding@resend.dev sender)"}; no mail sent`;
  },
};

const vercel: Probe = {
  name: "Vercel",
  env: ["VERCEL_TOKEN"],
  async run(ctx) {
    const token = pick(ctx.env, "VERCEL_TOKEN", "VERCEL_API_KEY");
    if (!token) throw new Skip("VERCEL_TOKEN not set — deploys run manually");
    const { res, json } = await getJson(ctx, "https://api.vercel.com/v9/projects?limit=20", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw httpError("Vercel /projects", res, json);
    const names = ((json?.projects as Array<{ name: string }>) ?? []).map((p) => p.name);
    return `${names.length} projects${names.length ? `: ${names.slice(0, 5).join(", ")}` : ""}`;
  },
};

const modal: Probe = {
  name: "Modal",
  env: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"],
  timeoutMs: 20_000,
  async run(ctx) {
    if (!pick(ctx.env, "MODAL_TOKEN_ID") || !pick(ctx.env, "MODAL_TOKEN_SECRET")) throw new Skip("MODAL_TOKEN_ID/SECRET not set — worker runs locally");
    let out: string;
    try {
      out = await ctx.exec("modal", ["token", "info"], { env: ctx.env, signal: ctx.signal });
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") throw new Skip("modal CLI not installed (pip install modal) — cannot probe");
      throw err;
    }
    const workspace = out.match(/Workspace:\s*([^\s(]+)/)?.[1];
    if (!workspace) throw new Error("`modal token info` did not report a workspace");
    return `token valid, workspace ${workspace} (modal token info)`;
  },
};

const posthog: Probe = {
  name: "PostHog",
  env: ["NEXT_PUBLIC_POSTHOG_KEY", "NEXT_PUBLIC_POSTHOG_HOST"],
  async run(ctx) {
    const key = pick(ctx.env, "NEXT_PUBLIC_POSTHOG_KEY");
    if (!key) throw new Skip("NEXT_PUBLIC_POSTHOG_KEY not set — analytics disabled");
    const host = (pick(ctx.env, "NEXT_PUBLIC_POSTHOG_HOST", "POSTHOG_HOST") ?? "https://eu.i.posthog.com").replace(/\/$/, "");
    // Feature-flag evaluation: authenticates the project key without capturing an event.
    const { res, json } = await getJson(ctx, `${host}/flags?v=2`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key, distinct_id: "env-check" }) });
    if (!res.ok) throw httpError("PostHog /flags", res, json);
    return `${new URL(host).host} project key accepted, ${Object.keys((json?.flags as object) ?? {}).length} flags; no event captured`;
  },
};

export function parseDsn(dsn: string): { key: string; host: string; projectId: string; envelope: string } | null {
  try {
    const u = new URL(dsn);
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    const prefix = parts.length ? `/${parts.join("/")}` : "";
    return { key: u.username, host: u.host, projectId, envelope: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/` };
  } catch {
    return null;
  }
}

const sentry: Probe = {
  name: "Sentry",
  env: ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN"],
  async run(ctx) {
    const dsn = pick(ctx.env, "SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN");
    if (!dsn) throw new Skip("SENTRY_DSN not set — errors go to the console only");
    const d = parseDsn(dsn);
    if (!d) throw new Error(`SENTRY_DSN is not a DSN URL (https://<key>@<host>/<project>)${dsn.startsWith("sntry") ? " — it looks like a Sentry auth token; copy the DSN from Sentry → Project Settings → Client Keys" : ""}`);
    // A client_report envelope authenticates the DSN without creating an issue or event.
    const body = [JSON.stringify({ sent_at: new Date().toISOString() }), JSON.stringify({ type: "client_report" }), JSON.stringify({ timestamp: Date.now() / 1000, discarded_events: [] })].join("\n");
    const res = await ctx.fetch(d.envelope, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${d.key}, sentry_client=orthogonal-check-env/1.0` },
      body,
      signal: ctx.signal,
    });
    if (!res.ok) throw new Error(`envelope HTTP ${res.status}`);
    return `${d.host} project ${d.projectId}; client_report accepted (no issue created)`;
  },
};

const anthropic: Probe = {
  name: "Anthropic (emergency only)",
  env: ["ANTHROPIC_API_KEY"],
  optional: true,
  async run(ctx) {
    const key = pick(ctx.env, "ANTHROPIC_API_KEY");
    if (!key) throw new Skip("ANTHROPIC_API_KEY not set: fine, every LLM call goes through the Mubit gateway");
    const { res, json } = await getJson(ctx, "https://api.anthropic.com/v1/models?limit=5", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (!res.ok) throw httpError("Anthropic /models", res, json);
    const ids = ((json?.data as Array<{ id: string }>) ?? []).map((m) => m.id);
    return `key valid (no tokens spent), e.g. ${ids.slice(0, 2).join(", ") || "no models"}; used only if MUBIT_GATEWAY_ENABLED=false`;
  },
};

const supabase: Probe = {
  name: "Supabase (legacy studio)",
  env: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  optional: true,
  async run(ctx) {
    const url = pick(ctx.env, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
    const key = pick(ctx.env, "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");
    if (!url || !key) throw new Skip("not configured — legacy studio only; the product runs on Convex");
    const res = await ctx.fetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: key }, signal: ctx.signal });
    if (!res.ok) throw new Error(`auth health HTTP ${res.status}`);
    return `${new URL(url).host} auth healthy`;
  },
};

const cloudflare: Probe = {
  name: "Cloudflare Browser Rendering",
  env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
  // A real browser render; slower than an API read, so it gets a longer budget.
  timeoutMs: 45_000,
  async run(ctx) {
    const token = pick(ctx.env, "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_WEB_CRAWLER_API");
    const account = pick(ctx.env, "CLOUDFLARE_ACCOUNT_ID");
    if (!token || !account) throw new Skip("CLOUDFLARE_ACCOUNT_ID/API_TOKEN not set — crawl uses plain fetch (no JS rendering)");
    const { res, json } = await getJson(ctx, `https://api.cloudflare.com/client/v4/accounts/${account}/browser-rendering/markdown`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    if (res.status === 429) throw new Warn("HTTP 429 rate limited (free-plan allowance); retry in a minute");
    const md = typeof json?.result === "string" ? json.result : "";
    if (!res.ok || !json?.success) throw new Error(`markdown HTTP ${res.status}: ${((json?.errors as Array<{ message: string }>) ?? []).map((e) => e.message).join(", ").slice(0, 160)}`);
    if (!/example domain/i.test(md)) throw new Error("rendered markdown missing the expected title");
    return `example.com rendered to ${md.length} chars of markdown`;
  },
};

/** Groups run in parallel; probes inside a group run in order (Mubit chat uses the model picked by /models). */
export const PROBE_GROUPS: Probe[][] = [[mubitModels, mubitChat], [mubitEmbed], [mubitMemory], [mubitFeedback], [convex], [github], [nango], [resend], [vercel], [modal], [posthog], [sentry], [anthropic], [supabase]];

/** Rate-limited services run alone after everything else. */
export const SERIAL_PROBES: Probe[] = [cloudflare];
