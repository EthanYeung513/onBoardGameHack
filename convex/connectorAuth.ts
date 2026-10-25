import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { NANGO_PROVIDERS, type ConnectorType } from "./lib/connectors";
import { fail } from "./lib/errors";

// Connect flows that need an outbound call (Convex actions). The token or Nango connection is
// verified with one cheap upstream call, then stored write-only via connectors.saveCredential.
// Nothing here returns or logs credential material.

const nangoHost = () => (process.env.NANGO_HOST || "https://api.nango.dev").replace(/\/$/, "");
const nangoKey = () => process.env.NANGO_SECRET_KEY || "";

async function nango(path: string, init: RequestInit = {}) {
  if (!nangoKey()) fail(503, "Nango is not configured (set NANGO_SECRET_KEY)");
  const res = await fetch(`${nangoHost()}${path}`, { ...init, headers: { Authorization: `Bearer ${nangoKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) fail(res.status === 404 ? 404 : 503, `Nango ${path.split("?")[0]} → HTTP ${res.status}`);
  return body;
}

type Integration = { unique_key: string; provider: string };

/** connector type → the Nango integration key configured for it, if any. */
async function nangoIntegrations(): Promise<Partial<Record<ConnectorType, string>>> {
  const { data } = (await nango("/integrations")) as { data?: Integration[] };
  const out: Partial<Record<ConnectorType, string>> = {};
  for (const [type, providers] of Object.entries(NANGO_PROVIDERS) as [ConnectorType, string[]][]) {
    const hit = (data ?? []).find((i) => providers.includes(i.provider));
    if (hit) out[type] = hit.unique_key;
  }
  return out;
}

/** GitHub PAT path: verify with GET /user, store write-only, queue the first full sync. */
export const connectGithub = action({
  args: { spaceId: v.id("spaces"), token: v.string(), repos: v.optional(v.array(v.string())) },
  handler: async (ctx, { spaceId, token, repos }): Promise<Id<"connectors">> => {
    const userId = await ctx.runQuery(internal.connectors.assertManager, { spaceId });
    const pat = token.trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(pat)) fail(422, "That doesn't look like a GitHub personal access token");
    const cleanRepos = (repos ?? []).map((r) => r.trim()).filter(Boolean);
    if (cleanRepos.some((r) => !/^[\w.-]+\/[\w.-]+$/.test(r))) fail(422, "Repositories must look like owner/repo");
    await ctx.runMutation(internal.connectors.markAuthing, { spaceId, type: "github" });
    const res = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json", "User-Agent": "orthogonal-connector" } });
    if (!res.ok) {
      const error = res.status === 401 ? "GitHub rejected that token (401)" : `GitHub returned HTTP ${res.status} checking the token`;
      await ctx.runMutation(internal.connectors.markAuthFailed, { spaceId, type: "github", error });
      fail(422, error);
    }
    const user = (await res.json()) as { login: string };
    return await ctx.runMutation(internal.connectors.saveCredential, {
      spaceId,
      userId,
      type: "github",
      kind: "pat",
      secret: pat,
      label: cleanRepos.length ? cleanRepos.join(", ") : user.login,
      config: { repos: cleanRepos },
    });
  },
});

/** Which Nango-backed tools have an integration configured on the Nango account (Tools tab). */
export const nangoStatus = action({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }): Promise<{ configured: boolean; integrations: Partial<Record<ConnectorType, string>> }> => {
    await ctx.runQuery(internal.connectors.assertManager, { spaceId });
    if (!nangoKey()) return { configured: false, integrations: {} };
    return { configured: true, integrations: await nangoIntegrations() };
  },
});

/** Short-lived Nango Connect session for one tool; the browser opens Nango's Connect UI with it. */
export const nangoSession = action({
  args: { spaceId: v.id("spaces"), type: v.union(v.literal("slack"), v.literal("jira"), v.literal("notion"), v.literal("drive")) },
  handler: async (ctx, { spaceId, type }): Promise<{ token: string; integration: string }> => {
    await ctx.runQuery(internal.connectors.assertManager, { spaceId });
    const key = (await nangoIntegrations())[type];
    if (!key) fail(503, `Needs Nango integration setup for ${type}`);
    await ctx.runMutation(internal.connectors.markAuthing, { spaceId, type });
    const { data } = (await nango("/connect/sessions", {
      method: "POST",
      body: JSON.stringify({ tags: { end_user_id: spaceId, space_id: spaceId }, allowed_integrations: [key] }),
    })) as { data: { token: string } };
    return { token: data.token, integration: key };
  },
});

/** Connect UI reported success: check the connection belongs to this space, then store its id. */
export const nangoConnected = action({
  args: { spaceId: v.id("spaces"), type: v.union(v.literal("slack"), v.literal("jira"), v.literal("notion"), v.literal("drive")), connectionId: v.string(), providerConfigKey: v.string() },
  handler: async (ctx, { spaceId, type, connectionId, providerConfigKey }): Promise<Id<"connectors">> => {
    const userId = await ctx.runQuery(internal.connectors.assertManager, { spaceId });
    const conn = (await nango(`/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`)) as {
      tags?: Record<string, string>;
      end_user?: { id?: string } | null;
      provider?: string;
    };
    const owner = conn.tags?.end_user_id ?? conn.end_user?.id;
    if (owner !== spaceId) fail(403, "That Nango connection belongs to another space");
    if (!NANGO_PROVIDERS[type]?.includes(conn.provider ?? "")) fail(422, `That connection is not a ${type} connection`);
    return await ctx.runMutation(internal.connectors.saveCredential, {
      spaceId,
      userId,
      type,
      kind: "oauth",
      secret: JSON.stringify({ provider: "nango", connectionId, providerConfigKey }),
      label: conn.provider ?? type,
    });
  },
});

/** Best-effort revoke on disconnect. */
export const revokeNango = internalAction({
  args: { secret: v.string() },
  handler: async (_ctx, { secret }) => {
    try {
      const { connectionId, providerConfigKey } = JSON.parse(secret) as { connectionId: string; providerConfigKey: string };
      if (!nangoKey()) return;
      await fetch(`${nangoHost()}/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(providerConfigKey)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${nangoKey()}` },
      });
    } catch {
      // best effort: the credential row is already gone
    }
  },
});
