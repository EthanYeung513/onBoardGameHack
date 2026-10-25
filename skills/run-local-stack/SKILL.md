---
name: run-local-stack
description: Boot the app locally with a seeded demo space, verify env wiring, and recover from the known gotchas (node PATH, Convex local deployment, stale dev servers).
---

# Run the local stack

## 1. Environment

- Node is not on PATH on Devin machines: `export PATH=~/.nvm/versions/node/v24.19.0/bin:$PATH`.
- `npm install` uses the public registry (project `.npmrc` — do not repoint at a work registry).
- `cp .env.example .env.local`. Everything works with no keys (offline stand-ins,
  labelled). To exercise a provider, set its vars, then prove them with
  `npm run check:env` — a pass/fail table, one real call per service.

## 2. Boot

```bash
npm install
npm run dev      # Docker Convex backend + functions + auth keys + demo seed + next dev
```

`npm run dev` (`scripts/dev.mjs`) is idempotent: it starts `.convex-local` in Docker, writes
`CONVEX_SELF_HOSTED_*`/`NEXT_PUBLIC_CONVEX_*` to `.env.local` on first boot, pushes `convex/`,
sets the Convex Auth signing keys, copies provider keys into the Convex function env, seeds
`demo@orthogonal.dev` / `demo-password` (Acme Pay), then runs `convex dev` + `next dev`.
`PORT=3100 npm run dev` picks another web port; `CONVEX_LOCAL_PORT=3510` gives this checkout
its own Docker backend (`convex-3510`, ports 3510–3512) — **use this whenever another checkout
or agent may be running `npm run dev`**, or the two `convex dev` watchers overwrite each other's
functions ("Schema was overwritten by another push"). `npm run dev` also starts the pipeline
worker (`npm run worker`) and generates `WORKER_SECRET`.

Entry points: `/` landing · `/login` manager sign-in · `/space/new` · `/dashboard` ·
`/try` public constructor · `/studio` legacy (Supabase) · Convex dashboard `http://127.0.0.1:6791`.

## 3. Gotchas

- **Convex local deployment.** The native `npx convex dev --local` binary needs a newer
  glibc than the VMs have — `npm run dev` uses the Docker backend instead. A shell that
  exports `CONVEX_DEPLOY_KEY`/`CONVEX_DEPLOYMENT` sends the CLI to the cloud deployment:
  run raw CLI commands as `env -u CONVEX_DEPLOY_KEY npx convex …`. `.env.local` must not
  set both `CONVEX_DEPLOYMENT` and `CONVEX_SELF_HOSTED_URL`.
- **Tests for Convex functions** use `convex-test` (`tests/convex/*.test.ts`, edge-runtime
  environment). Commit `convex/_generated` after changing functions (`npx convex dev --once`).
- Convex function env (LLM keys etc.) lives in the deployment's env —
  `npx convex env set` or the dashboard — not only in `.env.local`.
- `.env.local` holds `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOYMENT`; a
  self-hosted backend uses `CONVEX_SELF_HOSTED_URL` + `_ADMIN_KEY`.
- `next dev` rewrites the Next.js block at the top of `AGENTS.md`. Leave it
  committed; removing it only re-creates the diff.
- **`.env.local` hygiene.** Each checkout's `.env.local` must point at a *live* backend —
  its own `CONVEX_LOCAL_PORT` stack, or :3210 only for the preview app. Never run
  `npm run dev` without `CONVEX_LOCAL_PORT` in a second checkout: it would push your
  functions over the preview backend. `CONVEX_SELF_HOSTED_ADMIN_KEY` is written quoted
  (it contains `|`); `set -a; . ./.env.local` and `scripts/run-ts.mjs` both handle quotes.

