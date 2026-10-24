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
npx convex dev --local  # local Convex deployment (no cloud needed)
npm run db:seed         # seed Acme Pay demo space into it
npm run dev             # http://localhost:3000
```

Entry points: `/` constructor · `/studio` pipeline view · `/play` game ·
`/admin` manager console · `/status` env health. There is no auth locally when
Convex vars are unset; with them, accounts live in Convex Auth.

## 3. Gotchas

- **Convex local deployment.** `npx convex dev --local` runs the backend on
  this machine; `convex dev` against the cloud needs `CONVEX_DEPLOYMENT` +
  login. Kill stray `convex`/`node` processes if the local port is stuck.
- Convex function env (LLM keys etc.) lives in the deployment's env —
  `npx convex env set` or the dashboard — not only in `.env.local`.
- `.env.local` holds `NEXT_PUBLIC_CONVEX_URL` + `CONVEX_DEPLOYMENT`; a
  self-hosted backend uses `CONVEX_SELF_HOSTED_URL` + `_ADMIN_KEY`.
- `next dev` rewrites the Next.js block at the top of `AGENTS.md`. Leave it
  committed; removing it only re-creates the diff.
