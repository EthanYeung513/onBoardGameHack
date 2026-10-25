import type { WorldData } from "./contract";

/** The browser-side PostHog project key (public by design) for the world's own `world_opened` events. */
export function posthogFromEnv(env: NodeJS.ProcessEnv = process.env): { key: string; host: string } | null {
  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  return key ? { key, host: env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com" } : null;
}

/**
 * The prebuilt world's index.html for one company: a <base> pointing at the shared world bundle
 * (so its relative asset URLs resolve there), the company's name as the page title, its logo as
 * the favicon, and its world.json inlined as `window.OB_WORLD`, so the hire's first frame needs
 * no extra request. `assetBase` is "/world/" on this app, or an absolute URL for a Vercel deploy.
 */
export function worldHtml(index: string, world: WorldData, assetBase: string, analytics = posthogFromEnv()): string {
  // JSON inside <script>: escape "<" so no string in the content can close the tag.
  const data = JSON.stringify(world).replace(/</g, "\\u003c");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const head = [
    `<base href="${esc(assetBase)}">`,
    `<script>window.OB_WORLD=${data};</script>`,
    analytics ? `<script>window.OB_POSTHOG=${JSON.stringify(analytics).replace(/</g, "\\u003c")};</script>` : "",
    world.company.logoUrl ? `<link rel="icon" href="${esc(world.company.logoUrl)}">` : "",
  ].join("\n");
  return index
    .replace(/<head>/i, `<head>\n${head}`)
    .replace(/<title>[^<]*<\/title>/i, `<title>${esc(world.company.name)} onboarding</title>`);
}
