# Onboarding Studio

## Overview

Onboarding Studio takes a company website and produces three gamified onboarding flows that match the site's brand. It crawls the site, extracts design tokens, builds a structured model of the product, and shows the findings for review before anything is generated. After a few clarifying questions it designs a quest path, a checklist with streaks and a quiz-led tour. Each flow can be previewed, inspected as code, exported as a standalone React component and changed through chat.

All data lives in Supabase. Model calls go through the Mubit gateway to Anthropic. The app runs on Vercel and every page sits behind Supabase sign-in, apart from published flows.

## Architecture

The app is a Next.js 16 App Router project. The generator lives beside the existing GymQuest code and shares no tables or routes with it.

| Path | Purpose |
|---|---|
| `src/lib/env.ts` | Reads and validates every setting with Zod |
| `src/lib/llm/client.ts` | The only place an Anthropic client is created, for direct calls and for the chat |
| `src/lib/crawl/` | URL discovery, ranking, HTTP fetching and the Cloudflare Browser Rendering client |
| `src/lib/design/evidence.ts` | dembrandt runner and the HTML and CSS fallback |
| `src/lib/pipeline/` | Stage registry, runner, watchdog and the stages themselves |
| `src/lib/flow/` | FlowSpec schema, scoring rules, patches, versions and the standalone export |
| `src/lib/memory/` | The `MemoryProvider` interface and its Supabase and Mubit implementations |
| `src/components/gen/` | Studio interface and the flow renderer |
| `supabase/migrations/` | Schema, row level security, storage buckets and Realtime publication |

There are two interfaces over the same pipeline. The constructor at `/` (`src/components/orthogonal/`) is the guided flow for a new site: scan, an optional repository, a short description, the findings, then a workbench to edit and publish one onboarding. Its backend is `src/services/orthogonal/live.ts`, which starts pipeline work and answers the constructor's polling, and `src/lib/orthogonal/mapping.ts`, which translates findings, tokens and FlowSpecs into the constructor's types and applies its edits back onto the FlowSpec. The describe step stands in for the clarifying questions, so the constructor skips that gate. Entering no address shows the built-in lumen.energy demo. The studio at `/studio` shows everything for a project: the live timeline, editable findings, questions, all three variants, files, chat and memory. Each constructor screen links to its project in the studio.

The model never writes UI. It returns a FlowSpec in JSON, which is validated with Zod and a set of cross-field rules, and a renderer owned by the app turns it into the experience. Step types, transitions and gamification mechanics come from fixed sets. Points, streaks and badges are computed by deterministic rules in `src/lib/flow/scoring.ts`.

System prompts in `src/lib/prompts.ts` are identical for every project, and all project content goes in the user message. This keeps prompts cacheable and lets Mubit group each kind of call into one task. Every call sends `metadata.user_id` as `project:<id>`, so a project's calls form one session in Mubit.

## Setup

Install dependencies and copy the example environment file.

```bash
npm install
cp .env.example .env.local
```

The generator reads these variables. Names in brackets are accepted as alternatives.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Direct Anthropic key. Optional when the gateway is on |
| `ANTHROPIC_MODEL` | Model id, default `claude-opus-5-5` |
| `ANTHROPIC_EFFORT` | Sent as `output_config.effort`, default `medium` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project |
| `SUPABASE_ACCESS_TOKEN` [`SUPABASE_TOKEN_API`] | Management token used by the bootstrap script |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` [`CLOUDFLARE_WEB_CRAWLER_API`] | Browser Rendering |
| `MUBIT_API_KEY` [`MUBIT_API_TOKEN`], `MUBIT_ENDPOINT`, `MUBIT_GATEWAY_ENABLED` | Mubit gateway |
| `MEMORY_PROVIDER` | `supabase` (default) or `mubit` |
| `VERCEL_TOKEN` | Used by the status page |
| `DEMBRANDT_ENABLED` | Set to `true` where a local Chromium is available |

With a Supabase personal access token in the environment, one command finds the project, writes its URL and keys to `.env.local`, applies the migrations and adds the sign-in redirect URLs.

```bash
npm run supabase:bootstrap -- --redirect https://your-deployment.vercel.app
npm run dev
```

Accounts are created in Supabase Auth. Users sign in with a password or an email link.

## Deploy on Modal

`deploy/modal_app.py` builds a container with Node 22 and the Chromium that dembrandt uses, runs `next build` and serves `next start` on one warm container. On Modal the design tokens therefore come from dembrandt rather than the HTML and CSS fallback, and there is no function time limit on pipeline slices.

The app reads its settings from a Modal secret named `onboarding-studio`. It holds the same variables as `.env.local`, which are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MUBIT_API_KEY`, `CLOUDFLARE_API_TOKEN` and optionally `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY` and `APP_URL`. Set `APP_URL` to the Modal URL after the first deploy so the pipeline calls itself on the public HTTPS address.

To deploy from a machine with the Modal CLI, create the secret in the Modal dashboard (or with `modal secret create`) and run `npm run deploy:modal`. To deploy from GitHub, add `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` as repository secrets. The `Deploy to Modal` workflow then deploys every push to the feature branch. When the app variables above are also stored as repository secrets, the workflow writes them into the Modal secret first. Without the Modal tokens the workflow skips the deploy.

After the first deploy, run `npm run supabase:bootstrap -- --redirect <modal url>` so email sign-in links can return to the Modal address. Password sign-in works without it.

## Checks and tests

`npm run check:env` makes one real call to each service and prints a pass or fail table. The same checks appear on the signed-in `/status` page.

| Command | What it runs |
|---|---|
| `npm run lint`, `npm run typecheck` | ESLint and TypeScript |
| `npm test` | Vitest unit tests, including the FlowSpec and ProjectModel schemas, scoring, URL ranking, patches and the stage registry |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright suites in `e2e/` |
| `npm run crawl:sample -- <url>` | Crawls a site and writes the pages and a screenshot to `artifacts/crawl/` |

`e2e/click-all.spec.ts` signs in, follows every internal link and clicks every control, failing on console errors and failed requests. `e2e/pipeline.spec.ts` runs the whole pipeline through the interface against a real site, once with a live crawl and once with the cached crawl. It plays every flow to the end and checks the points against the scoring rules, makes a chat change and checks that memory calls were logged. Set `E2E_BASE_URL` to run the suites against a deployment. GitHub Actions runs lint, typecheck, unit tests and the build on every push.

## Pipeline

Each stage runs in short slices, one server invocation at a time, with its state in the `jobs` table. A slice writes `job_events` as it works and updates the heartbeat every three seconds. When a slice finishes, the endpoint schedules the next one in a fresh invocation.

| Stage | Work |
|---|---|
| `crawl` | Reads `robots.txt`, sitemaps and `llms.txt`, ranks URLs by path, fetches up to 30 pages over HTTP and falls back to the Cloudflare browser for thin pages, then stores up to five screenshots |
| `extract_design` | dembrandt or the HTML and CSS fallback, then the model normalises the evidence into design tokens |
| `analyse` | The model reads the pages, screenshots and tokens and returns a validated ProjectModel whose features cite crawled URLs |
| `awaiting_confirmation` | Waits while the team reviews and edits the findings |
| `ask_questions` | The model picks three to five questions from a fixed bank and phrases them for the company |
| `awaiting_answers` | Waits for answers |
| `generate_flows` | One variant per slice. Validation errors go back to the model for up to two more attempts |
| `validate` | Validates every flow and writes the spec, theme CSS and standalone component to `generated_files` |
| `ready` | Runs memory reflection |

A failing stage retries with backoff up to three times, then shows a readable error and a Retry button. Any running job whose heartbeat is older than 60 seconds is marked stalled and offers Resume. Stages write with upserts keyed by URL, version or variant, so resuming repeats no work. The project page follows `jobs` and `job_events` through Supabase Realtime, polls as a fallback, and asks the server to continue if a queued stage sits untouched. New stages are added in `src/lib/pipeline/registry.ts`.

## Memory

All memory code sits behind the `MemoryProvider` interface in `src/lib/memory/`, with named operations. `rememberSiteFacts` runs when findings are confirmed. `rememberDecision` runs for confirmations, answers and accepted chat changes. `getProjectContext` runs before each flow is generated and before every chat turn, with a token budget. `recordOutcome` runs when a flow fails validation and when a change is undone or rolled back. `reflect` runs when a project reaches `ready` and promotes recurring failures into lessons shared across projects.

Every call is written to `memory_events` and shown in the Memory tab. Exact values such as tokens, specs and scores stay in Supabase tables. Memory holds facts, decisions, reasons and lessons.

## Known limitations

The Mubit key in use serves only the gateway, so `remember` and `recall` return `unknown_route`. Memory therefore uses the Supabase provider by default, and the Mubit provider stays available behind `MEMORY_PROVIDER=mubit`.

dembrandt drives a local Chromium, which Vercel functions do not have. On Vercel, design tokens come from the site's HTML and CSS plus a screenshot read by the model, which can miss colours that only appear after scripts run.

The Cloudflare free plan allows about ten minutes of browser time a day and few requests per minute. The crawler uses the browser only for thin pages and caps screenshots at five per project, and the cached crawl lets a site be reused for 24 hours without browser time. The current Cloudflare token expires on 31 October 2026, after which browser fallbacks and screenshots fail until it is replaced.

The full FlowSpec is too large for constrained decoding, and the model does not accept a forced tool choice. Flow generation therefore offers a single `submit_result` tool whose input schema is the FlowSpec and asks the model to call it. The API returns the tool input as parsed JSON, and Zod validation with feedback retries catches anything else.

The constructor's Push to GitHub button returns an error for live projects, because opening pull requests on a customer's repository is outside this MVP. Its per-step colours are not carried into the published FlowSpec, which keeps one theme for the whole flow, so a published page uses the site's tokens rather than the colours chosen in the workbench.

The Modal client talks to Modal over gRPC, which some locked-down networks and HTTPS proxies do not pass, so deploys may need to run from GitHub Actions or a developer machine rather than a sandbox.

The live preview uses Sandpack, which loads its bundler from CodeSandbox's servers, so the Files tab preview needs internet access in the browser.

## Planned extensions

A match score stage comparing generated flows against the site's actual sign-up, a production audit stage, GitHub integration with the target company's repository, and per-flow analytics on completions and drop-off.
