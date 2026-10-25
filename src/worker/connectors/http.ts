// Authenticated HTTP for connector syncs: GitHub directly with the stored PAT, Slack/Jira/Notion/
// Drive through the Nango proxy with the stored connection id. Rate-limit aware (Retry-After,
// X-RateLimit-Reset); a 401/403-auth is a non-retryable ConnectorAuthError (503 → one attempt).

export class ConnectorAuthError extends Error {
  readonly code = 503;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Http {
  json<T = unknown>(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<T>;
  bytes(path: string, init?: { headers?: Record<string, string> }): Promise<ArrayBuffer>;
  text(path: string, init?: { headers?: Record<string, string> }): Promise<string>;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Seconds to wait before retrying a rate-limited response, or null when it isn't one. */
export function retryAfterMs(res: Pick<Response, "status" | "headers">, now = Date.now()): number | null {
  const ra = res.headers.get("retry-after");
  if (res.status === 429 || (res.status === 403 && (ra || res.headers.get("x-ratelimit-remaining") === "0"))) {
    if (ra && /^\d+$/.test(ra)) return Number(ra) * 1000;
    const reset = res.headers.get("x-ratelimit-reset");
    if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1000 - now);
    return 5000;
  }
  return null;
}

export function createHttp(opts: {
  service: string;
  baseUrl: string;
  headers: Record<string, string>;
  fetch?: FetchFn;
  /** Longest in-slice wait for a rate limit; longer waits fail the slice (Convex backs off). */
  maxWaitMs?: number;
}): Http {
  const doFetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const maxWait = opts.maxWaitMs ?? 20_000;

  async function request(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
    const url = /^https?:\/\//.test(path) ? path : `${opts.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, {
        method: init.method ?? "GET",
        headers: { ...opts.headers, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
      const wait = retryAfterMs(res);
      if (wait !== null) {
        if (attempt < 2 && wait <= maxWait) {
          await sleep(wait);
          continue;
        }
        throw new HttpError(res.status, `${opts.service} rate limit: retry in ${Math.ceil(wait / 1000)}s`);
      }
      if (res.status === 401) throw new ConnectorAuthError(`${opts.service} rejected the stored credential (401). Reconnect ${opts.service}.`);
      if (!res.ok) throw new HttpError(res.status, `${opts.service} ${(init.method ?? "GET").toUpperCase()} ${path.split("?")[0]} → HTTP ${res.status}`);
      return res;
    }
  }

  return {
    async json(path, init) {
      return (await (await request(path, init)).json()) as never;
    },
    async bytes(path, init) {
      return await (await request(path, init)).arrayBuffer();
    },
    async text(path, init) {
      return await (await request(path, init)).text();
    },
  };
}

/** Nango proxy client for one connection (https://nango.dev/docs/reference/api/proxy). */
export function nangoHttp(service: string, connection: { connectionId: string; providerConfigKey: string }, fetchFn?: FetchFn): Http {
  const key = process.env.NANGO_SECRET_KEY;
  if (!key) throw new ConnectorAuthError(`Nango is not configured (set NANGO_SECRET_KEY), so ${service} can't sync`);
  const host = (process.env.NANGO_HOST || "https://api.nango.dev").replace(/\/$/, "");
  return createHttp({
    service,
    baseUrl: `${host}/proxy`,
    fetch: fetchFn,
    headers: { Authorization: `Bearer ${key}`, "Connection-Id": connection.connectionId, "Provider-Config-Key": connection.providerConfigKey },
  });
}
