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

## 3. Vercel + Modal — hosting (FREE tiers cover the demo)

Split: **Vercel** serves the Next.js web app; **Modal** runs the pipeline
worker (dembrandt needs real Chromium — serverless can't) + scheduled
re-sync jobs (F34). Chosen over Railway — it was down at setup time, and the
scaffold already deploys to Modal (`deploy/modal_app.py`).

1. [vercel.com](https://vercel.com) → **Continue with GitHub** →
   **Import Project** `onBoardGameHack` (root = repo root, framework
   auto-detected Next.js). Token: avatar → **Account Settings → Tokens →
   Create Token** → `VERCEL_TOKEN` → secrets.
2. [modal.com](https://modal.com) → sign up → **Settings → API Tokens →
   Create Token** → `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` → secrets.
   `deploy/modal_app.py` reads them; first deploy creates the
   `onboarding-studio` secret in the Modal dashboard with the app's env vars.

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

## Verify with `npm run check:env`

One real, cheap, read-only call per row (`src/lib/status/probes.ts`; also shown on `/status`).
Results: **PASS**; **FAIL** (configured required service broken → exit 1); **WARN** (optional
service broken); **SKIP** (not configured → offline stand-in). Checks run in parallel with a 10 s
timeout each (Modal 20 s, Cloudflare 45 s and run alone, after the rest, because of its rate limit).
`OFFLINE=1` skips every row. Output never contains secret values.

| Row | Env vars | Probe |
| --- | --- | --- |
| Mubit models | `MUBIT_API_KEY`, `MUBIT_BASE_URL`, `MUBIT_MODEL` | `GET /models`; fails if `MUBIT_MODEL` isn't served; unset → picks `gpt-5.4-mini` and says so |
| Mubit chat (JSON) | `MUBIT_API_KEY`, `MUBIT_MODEL`, `MUBIT_TASK_HEADER` | one `chat.completions` JSON call through `MubitClient` (`src/llm/mubit.ts`), task `env-check`; reports the model used |
| Mubit embeddings | `MUBIT_API_KEY`, `MUBIT_EMBED_MODEL` | one embedding via the worker embedder, `dimensions: 1536`, asserts the width |
| Mubit memory (optional) | `MUBIT_API_KEY`, `MUBIT_ENDPOINT` | SDK remember + recall in a scratch session |
| Mubit feedback endpoint (optional) | `MUBIT_FEEDBACK_URL` | `GET` the endpoint (no feedback posted); SKIP when unset (distil fallback) |
| Convex | `NEXT_PUBLIC_CONVEX_URL` / `CONVEX_SELF_HOSTED_URL` / `CONVEX_DEPLOYMENT` | `GET /version`; reports self-hosted vs cloud |
| GitHub connector | `GITHUB_CONNECTOR_PAT` | `GET /user` + rate limit remaining |
| Nango | `NANGO_SECRET_KEY`, `NANGO_HOST` | `GET /integrations`; lists which of slack, jira, notion, google-drive, github are configured |
| Resend | `RESEND_API_KEY` | `GET /domains` (a send-only key is accepted as valid); never sends mail |
| Vercel | `VERCEL_TOKEN` | `GET /v9/projects` |
| Modal | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | `modal token info` (SKIP if the CLI isn't installed) |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | `POST /flags?v=2` — authenticates the key without capturing an event |
| Sentry | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | parses the DSN, posts an empty `client_report` envelope (no issue/event created) |
| Anthropic (optional) | `ANTHROPIC_API_KEY` | `GET /v1/models` (no tokens spent) |
| Supabase (optional, legacy) | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `GET /auth/v1/health` |
| Cloudflare Browser Rendering | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | renders `https://example.com` to markdown once (HTTP 429 → WARN: free-plan rate limit) |

## Once keys exist — the wiring I do

`.env.local` + Convex env get the values → `npm run check:env` proves each
with one real call → Railway env mirrors `.env.example` for deploys. Say
"here's the Mubit key" etc. and I'll wire + verify each one live.

## Google sign-in (Convex Auth)

Provisioned 2026-10-25. `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` live in the **Convex
deployment env** (cloud `rapid-mosquito-655` and the local self-hosted backend on :3210) —
`convex/auth.ts` enables the provider and `authInfo.providers` lights the login buttons only
when both are set. Authorised redirect URIs on the Google OAuth client:

- local: `http://127.0.0.1:3211/api/auth/callback/google` (the backend's `CONVEX_SITE_ORIGIN`)
- cloud: `https://rapid-mosquito-655.convex.site/api/auth/callback/google`

After Google, Convex Auth returns to the deployment's `SITE_URL` (local `http://localhost:3000`;
set on the cloud deployment to `https://orthogonal-app.vercel.app`, 2026-10-25). Sign-in returns to the origin
the manager started on when it is `SITE_URL`, listed in `SITE_URL_ALLOWLIST`, or loopback on a dev backend
(`convex/lib/authRedirect.ts`). The cloud deployment also needs `JWT_PRIVATE_KEY`/`JWKS`
(`node scripts/convex-auth-keys.mjs` with the deploy key) — without them every sign-in fails. Apple sign-in is out of scope.

