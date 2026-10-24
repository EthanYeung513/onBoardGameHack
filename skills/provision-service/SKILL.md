---
name: provision-service
description: Add a new external service/env var end to end — .env.example, check:env, offline behavior, docs tables — so nothing is half-wired.
---

# Provision a new service

Every env var and provider is wired in four places in the same PR:

1. `.env.example` — the var with a comment and any accepted alternate names in
   brackets (existing convention).
2. `scripts/check-env.ts` — one real call proving the key works, added to the
   pass/fail table. Never mark a service OK without calling it.
3. Offline path — what the app does when the var is unset: the documented
   stand-in (labelled) or `503`. Write it before the real path.
4. Docs — add the row to PRD's provisioning table and to
   `docs/onboarding-studio.md`'s variable table if it's generator-facing.

## Rules

- Secrets never enter the repo, prompts or logs. Customer credentials →
  `connector_credentials` via `auth_ref` (see `add-tool-connector`).
- Read env through `src/lib/env.ts` (Zod-validated) — no bare `process.env`
  scattered through the app.
- If the service needs a runtime (Chromium, long jobs), it runs on the worker
  host (Railway/Modal), not in serverless functions — say so in its docs row.
