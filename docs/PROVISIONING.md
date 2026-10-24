# Provisioning — every tool, every key

Step-by-step for creating each account and where each key goes. Three homes
for secrets:

- **`.env.local`** (gitignored) — web-app env, used by Next.js locally.
- **Convex dashboard env** (deployment → Settings → Environment Variables) —
  secrets used *inside* Convex functions/actions (LLM calls, connector syncs).
  Code running in Convex can't see `.env.local`.
- **Railway env** (project → service → Variables) — deploy-time env mirroring
  `.env.example`.
- **Devin session secrets** — hand keys to Devin via the secrets prompt, never
  pasted in chat or committed.

In dependency order — the top ones unblock everything else.

---

## 1. Convex — database + auth + storage + crons + vector search (FREE)

What it replaces: Supabase/Postgres + the realtime + auth + storage + cron
layers, in one free plan (reactive DB, file storage, text+vector search, crons,
auth, 6 dev seats — evidence: convex.dev/pricing).

1. [convex.dev](https://convex.dev) → **Get started** → sign in with GitHub.
2. Dashboard → **New Project** → name `orthogonal`.
3. In the repo: `npx convex dev` — creates a dev deployment and writes
   `CONVEX_DEPLOYMENT` + `NEXT_PUBLIC_CONVEX_URL` into `.env.local` itself.
   Nothing to copy by hand.
4. For CI/Railway deploys later: dashboard → project **Settings → Deploy
   Keys** → `CONVEX_DEPLOY_KEY`.
5. Offline/local: `npx convex dev --local` runs a local backend — no account
   needed (self-host via docker-compose is the fallback).

## 2. Mubit — all LLM calls + embeddings (hackathon keys)

1. Keys come from the hackathon pack / Mubit mentors — grab:
   `MUBIT_API_KEY`, `MUBIT_ENDPOINT`, `MUBIT_EMBED_MODEL`.
2. These are used inside Convex actions → set them in the **Convex dashboard
   env**, plus `.env.local` for local scripts.

## 3. Railway — hosting: web + worker + cron (~free for the demo)

1. [railway.com](https://railway.com) → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → pick `onBoardGameHack`.
3. Token for CI/agents: avatar → **Account Settings → Tokens → New Token** →
   `RAILWAY_TOKEN` → give to Devin via secrets.
4. Later: the repo deploys on push; add a second service for the pipeline
   worker + a cron for F34 re-syncs.
- Cost honesty: one-time trial credit, then Hobby ≈ $5/mo. Modal fallback
  (`deploy/modal_app.py`) stays green.

## 4. Resend — invite + magic-link emails (FREE 3,000/mo, 100/day)

1. [resend.com](https://resend.com) → sign up → **API Keys → Create API Key**
   (send + full access, name it `orthogonal`) → `RESEND_API_KEY`.
2. Testing needs **no domain** — use the built-in `onboarding@resend.dev`
   sender; verify a real domain later.
3. Goes in `.env.local` + Convex env (Convex Auth magic links send through it).

## 5. Nango — Slack/Notion/Jira/Drive OAuth broker (FREE tier)

1. [nango.dev](https://nango.dev) → sign up → it provisions a dev environment.
2. Dashboard → **Environment Settings → Secret Key** → `NANGO_SECRET_KEY` →
   Convex env + `.env.local`.
3. Per tool (later, Phase 3): Nango dashboard → Integrations → pick Slack /
   Notion / Jira / Google Drive → create provider OAuth app (Nango shows the
   exact redirect URL to paste) → record `NANGO_INTEGRATION_<TOOL>` ids.
   GitHub stays a direct app/PAT — Nango only brokers the OAuth-heavy ones.

## 6. GitHub connector — repo/docs/members ingest (FREE)

Fast path for the demo — a fine-grained PAT:
1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained** → New token → pick a demo org/repo, read-only contents +
   metadata → give the token to Devin via secrets.

Real path (Phase 3): **Settings → Developer settings → OAuth Apps** →
callback `https://<app>/api/connectors/github/callback` → `GITHUB_CLIENT_ID` +
`GITHUB_CLIENT_SECRET`.

## 7. Anthropic — direct LLM fallback (NOT free — pay-as-you-go)

1. [console.anthropic.com](https://console.anthropic.com) → sign up → add a
   billing amount ($5 is plenty) → **API Keys → Create Key** →
   `ANTHROPIC_API_KEY` → Convex env + `.env.local`.
2. If Mubit covers all calls, skip this until needed.

## 8. Cloudflare — Browser Rendering for JS-heavy pages (small FREE allowance)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → sign up free →
   create an account (Workers). **Account ID** is on the right-hand sidebar →
   `CLOUDFLARE_ACCOUNT_ID`.
2. **My Profile → API Tokens → Create Token** → "Browser Rendering" or
   Workers Edit template → `CLOUDFLARE_API_TOKEN`.
3. Free plan ≈ ~10 browser-minutes/day; Workers Paid ($5/mo) lifts it. Our
   crawl caches pages for 24 h, so the free allowance stretches.

## 9. PostHog — product + agent analytics (FREE 1M events/mo)

1. [posthog.com](https://posthog.com) → sign up → create project `orthogonal`.
2. **Project Settings → Project API Key** → `NEXT_PUBLIC_POSTHOG_KEY`
   (+ `NEXT_PUBLIC_POSTHOG_HOST` already in `.env.example`).

## 10. Sentry — error tracking (FREE dev tier ~5k errors/mo)

1. [sentry.io](https://sentry.io) → sign up → **New Project → Next.js** → the
   wizard prints the DSN → `SENTRY_DSN`.

---

## Skip for now

- **Voyage AI** — standby only if `MUBIT_EMBED_MODEL` can't serve embeddings.
- **Browserbase** — P2 internal-web-app connector only.
- **Gephi** — optional desktop app for offline graph inspection; the brain
  page is cosmos.gl in-browser, `GET /api/brain/graph.gexf` feeds Gephi.

## Once keys exist — the wiring I do

`.env.local` + Convex env get the values → `npm run check:env` proves each
with one real call → Railway env mirrors `.env.example` for deploys. Say
"here's the Mubit key" etc. and I'll wire + verify each one live.
