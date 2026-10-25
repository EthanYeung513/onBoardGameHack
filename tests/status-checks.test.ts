import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/memory/mubit-provider", () => ({ probeMubitMemory: vi.fn(async () => ({ ok: true })) }));

import { exitCode, formatTable, runAllChecks, type CheckResult, type EnvLike, type ExecFn } from "@/lib/status/checks";
import { parseDsn } from "@/lib/status/probes";

const FAKE = {
  MUBIT_API_KEY: "mubit-FAKE-SECRET-0001",
  GITHUB_CONNECTOR_PAT: "github_pat_FAKE_SECRET_0002",
  NANGO_SECRET_KEY: "nango-FAKE-SECRET-0003",
  RESEND_API_KEY: "re_FAKE_SECRET_0004",
  VERCEL_TOKEN: "vercel-FAKE-SECRET-0005",
  MODAL_TOKEN_ID: "ak-FAKE-SECRET-0006",
  MODAL_TOKEN_SECRET: "as-FAKE-SECRET-0007",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_FAKE_SECRET_0008",
  ANTHROPIC_API_KEY: "sk-ant-FAKE-SECRET-0009",
  CLOUDFLARE_API_TOKEN: "cf-FAKE-SECRET-0010",
};
const DSN_KEY = "abcdef0123456789FAKE";
const FULL_ENV: EnvLike = {
  ...FAKE,
  CLOUDFLARE_ACCOUNT_ID: "acct",
  MUBIT_FEEDBACK_URL: "feedback",
  NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3670",
  SENTRY_DSN: `https://${DSN_KEY}@o1.ingest.sentry.io/42`,
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** A fake of every provider's happy path, keyed by URL. */
function happyFetch(overrides: Record<string, () => Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    for (const [frag, make] of Object.entries(overrides)) if (url.includes(frag)) return make();
    if (url.endsWith("/models")) return json({ data: [{ id: "gpt-5.4-mini" }, { id: "gpt-5.5" }, { id: "text-embedding-3-large" }] });
    if (url.endsWith("/chat/completions"))
      return json({ id: "c1", model: "gpt-5.4-mini-2026", choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } });
    if (url.endsWith("/embeddings")) return json({ data: [{ embedding: new Array(1536).fill(0.1) }] });
    if (url.endsWith("/feedback")) return json({}, 405);
    if (url.endsWith("/version")) return new Response("1.2.3");
    if (url.includes("api.github.com/user")) return json({ login: "octo" }, 200, { "x-ratelimit-remaining": "4999" });
    if (url.includes("/integrations")) return json({ data: [{ provider: "github" }, { provider: "slack" }] });
    if (url.includes("resend.com")) return json({ data: [] });
    if (url.includes("vercel.com")) return json({ projects: [{ name: "orthogonal" }] });
    if (url.includes("/flags")) return json({ flags: {} });
    if (url.includes("sentry.io")) return json({});
    if (url.includes("anthropic.com")) return json({ data: [{ id: "claude-x" }] });
    if (url.includes("browser-rendering")) return json({ success: true, result: "# Example Domain" });
    return json({ error: "unexpected" }, 500);
  }) as typeof fetch;
}

const modalOk: ExecFn = async () => "Token: ***\nWorkspace: team (ac-1)\n";
/** MubitClient uses its own transport (global fetch), so the fake is installed globally too. */
async function check(opts: Parameters<typeof runAllChecks>[0] & { fetch: typeof fetch }) {
  vi.stubGlobal("fetch", opts.fetch);
  return runAllChecks(opts);
}
afterEach(() => vi.unstubAllGlobals());

const byName = (rs: CheckResult[]) => Object.fromEntries(rs.map((r) => [r.name, r]));

describe("check:env", () => {
  it("passes every configured service and picks a Mubit model from /models", async () => {
    const rs = await check({ env: FULL_ENV, fetch: happyFetch(), exec: modalOk });
    const failed = rs.filter((r) => r.status !== "pass" && r.status !== "skip");
    expect(failed).toEqual([]);
    const r = byName(rs);
    expect(r["Mubit models"].detail).toContain("MUBIT_MODEL unset → using gpt-5.4-mini");
    expect(r["Mubit embeddings"].detail).toContain("1536 dims");
    expect(r["Nango"].detail).toContain("connectors configured: slack, github");
    expect(r["Supabase (legacy studio)"].status).toBe("skip");
    expect(rs.at(-1)?.name).toBe("Cloudflare Browser Rendering");
    expect(exitCode(rs)).toBe(0);
  });

  it("skips everything when nothing is configured, and under OFFLINE=1", async () => {
    const fetchSpy = vi.fn(happyFetch());
    for (const env of [{}, { ...FULL_ENV, OFFLINE: "1" }]) {
      const rs = await check({ env, fetch: fetchSpy as typeof fetch, exec: modalOk });
      expect(rs.every((r) => r.status === "skip")).toBe(true);
      expect(exitCode(rs)).toBe(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails a required service but only warns for an optional one", async () => {
    const rs = byName(
      await check({
        env: FULL_ENV,
        fetch: happyFetch({ "api.github.com": () => json({ message: "Bad credentials" }, 401), "anthropic.com": () => json({ error: { message: "invalid x-api-key" } }, 401),
          "browser-rendering": () => json({ success: false, errors: [{ message: "Rate limit exceeded" }] }, 429),
        }),
        exec: modalOk,
      }),
    );
    expect(rs["GitHub connector"]).toMatchObject({ status: "fail", detail: expect.stringContaining("401") });
    expect(rs["Anthropic (optional)"].status).toBe("warn");
    expect(rs["Cloudflare Browser Rendering"].status).toBe("warn"); // rate limited, not broken
    expect(exitCode(Object.values(rs))).toBe(1);
  });

  it("fails when MUBIT_MODEL is not served, and when embeddings are the wrong width", async () => {
    const rs = byName(
      await check({ env: { ...FULL_ENV, MUBIT_MODEL: "gpt-nope" }, fetch: happyFetch({ "/embeddings": () => json({ data: [{ embedding: [1, 2, 3] }] }) }), exec: modalOk }),
    );
    expect(rs["Mubit models"]).toMatchObject({ status: "fail", detail: expect.stringContaining("gpt-nope") });
    expect(rs["Mubit embeddings"].status).toBe("fail");
  });

  it("times out a hung check without blocking the others", async () => {
    const hang = () => new Promise<Response>(() => {});
    const started = Date.now();
    const rs = byName(
      await check({ env: FULL_ENV, fetch: happyFetch({ "vercel.com": hang as never, "/version": hang as never }), exec: modalOk, timeoutMs: 150 }),
    );
    expect(rs["Vercel"]).toMatchObject({ status: "fail", detail: expect.stringContaining("timed out") });
    expect(rs["Convex"].status).toBe("fail");
    expect(rs["GitHub connector"].status).toBe("pass");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("never prints a secret value, even when a provider echoes it back", async () => {
    const echo = (v: string) => () => json({ message: `invalid token ${v}` }, 401);
    const rs = await check({
      env: FULL_ENV,
      fetch: happyFetch({ "api.github.com": echo(FAKE.GITHUB_CONNECTOR_PAT), "vercel.com": echo(FAKE.VERCEL_TOKEN), "/version": () => new Response(FAKE.MUBIT_API_KEY) }),
      exec: async () => `Workspace: ${FAKE.MODAL_TOKEN_SECRET}`,
    });
    const out = formatTable(rs) + JSON.stringify(rs);
    for (const v of [...Object.values(FAKE), DSN_KEY]) expect(out).not.toContain(v);
    expect(out).toContain("***");
  });

  it("parses Sentry DSNs and rejects an auth token in SENTRY_DSN", async () => {
    expect(parseDsn("https://k3y@o1.ingest.sentry.io/42")).toMatchObject({ key: "k3y", projectId: "42", envelope: "https://o1.ingest.sentry.io/api/42/envelope/" });
    expect(parseDsn("sntryu_abc")).toBeNull();
    const rs = byName(await check({ env: { SENTRY_DSN: "sntryu_FAKE_TOKEN_123" }, fetch: happyFetch(), exec: modalOk }));
    expect(rs["Sentry"]).toMatchObject({ status: "fail", detail: expect.stringContaining("auth token") });
    expect(rs["Sentry"].detail).not.toContain("sntryu_FAKE_TOKEN_123");
  });
});
