// Where Convex Auth sends the browser after OAuth (Google): back to the origin the manager started
// on — the local preview, a forwarded preview URL or the Vercel app — instead of always SITE_URL,
// which strands anyone not browsing from that exact origin on a blank/unreachable page.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Relative paths and `?query` resolve against `siteUrl` (Convex Auth's default). An absolute URL is
 * honoured when its origin is `siteUrl`, listed in `allowlist`, or a loopback origin while
 * `siteUrl` itself is loopback (local dev on any port). Anything else falls back to `siteUrl`.
 */
export function resolveAuthRedirect(redirectTo: string, siteUrl: string, allowlist: string[] = []): string {
  const site = siteUrl.replace(/\/$/, "");
  if (redirectTo.startsWith("?") || (redirectTo.startsWith("/") && !redirectTo.startsWith("//"))) return `${site}${redirectTo}`;
  const origin = originOf(redirectTo);
  if (!origin) return site;
  const allowed = new Set([originOf(site), ...allowlist.map((a) => originOf(a.trim()))].filter(Boolean) as string[]);
  if (allowed.has(origin)) return redirectTo;
  const siteHost = originOf(site) ? new URL(site).hostname : "";
  if (LOOPBACK.has(siteHost) && LOOPBACK.has(new URL(redirectTo).hostname) && /^https?:$/.test(new URL(redirectTo).protocol)) return redirectTo;
  return site;
}

export function allowlistFromEnv(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}
