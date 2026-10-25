// Hires opening a company's onboarding world (QR scans, shared links), for the PostHog dashboard.
// Deliberately separate from Orthogonal's own site analytics (src/components/analytics): no
// $pageview and no autocapture here, only `world_opened` tagged app=world with the space slug, so
// world visits are never blended with Orthogonal visitors. The server injects the project key as
// window.OB_POSTHOG (src/lib/world/html.ts); without it nothing is sent.
import posthog from 'posthog-js';
import type { WorldConfig } from './config';

declare global {
  interface Window { OB_POSTHOG?: { key: string; host: string } }
}

/** /o/<slug> on the Orthogonal app; a company's own deployment has no slug in its path. */
export function spaceSlug(pathname: string, fallback: string): string {
  return pathname.match(/^\/o\/([^/]+)/)?.[1] ?? fallback;
}

export function trackWorldOpened(cfg: WorldConfig) {
  const ph = window.OB_POSTHOG;
  if (!ph?.key) return;
  const slug = spaceSlug(location.pathname, cfg.company.host);
  posthog.init(ph.key, {
    api_host: ph.host,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
    disable_session_recording: true,
    person_profiles: 'identified_only',
  });
  posthog.register({ app: 'world', space_slug: slug });
  posthog.capture('world_opened', { space_slug: slug, company: cfg.company.name });
}
