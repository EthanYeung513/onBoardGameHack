---
name: run-local-stack
description: Boot the app locally with a seeded demo space, verify env wiring, and recover from the known gotchas (node PATH, PGlite lockfile, corrupt .data).
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
npm run db:seed      # local PGlite in .data/, seeded with Acme Pay
npm run dev          # http://localhost:3000
```

Entry points: `/` constructor · `/studio` pipeline view · `/play` game ·
`/admin` manager console · `/status` env health. There is no auth locally when
Supabase vars are unset; with them, accounts live in Supabase Auth.

## 3. Gotchas

- **PGlite is single-process.** `db:seed`, `bulk-grade`, `eval --record` need
  the dev server stopped (or point `DATABASE_URL` at Supabase). A stale
  `.data/pglite.lock` after a killed process means check for stray `node`
  processes first; the lock refuses a second live opener on purpose.
- Corrupt DB → `.data/pglite-corrupt-*` folders were moved aside, not deleted;
  reseed rather than repair.
- `DATABASE_URL=localhost:5432` is refused on purpose (it was someone's SSH
  tunnel to work DBs). Use PGlite or a hosted string.
- `next dev` rewrites the Next.js block at the top of `AGENTS.md`. Leave it
  committed; removing it only re-creates the diff.
