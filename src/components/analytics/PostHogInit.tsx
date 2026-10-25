"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

// Orthogonal's own visitor analytics (landing + manager app): pageviews on every client-side
// navigation, autocapture and session replay (when the PostHog project enables it). Everything is
// tagged app=orthogonal. Hires' onboarding worlds (/o/<slug>) are a separate stream: they never
// load this, and report only `world_opened` with app=world (world/src/analytics.ts), so the two
// are never counted together. No key → no-op.

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

export function PostHogInit() {
  useEffect(() => {
    if (!KEY || posthog.__loaded) return;
    posthog.init(KEY, {
      api_host: HOST,
      capture_pageview: "history_change",
      person_profiles: "identified_only",
    });
    posthog.register({ app: "orthogonal" });
  }, []);
  return null;
}
