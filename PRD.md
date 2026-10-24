# Orthogonal product requirements

Scope: **the manager-facing product** — landing page, sign-up/login, space creation,
website scan, tool connections, the company brain (knowledge graph), onboarding
generation, editor, dashboard and publish/play handoff. The hire-facing game world
(Phaser, `world/` on `devin/1792873985-stardew-world`) and the Mubit grading loop
([PLAN.md](PLAN.md)) are explicitly out of scope except where they consume this
product's outputs.

Structure and conventions follow [Fergus-MW/propadm.in](https://github.com/Fergus-MW/propadm.in);
the multi-agent build process is in [docs/AGENT-BUILD.md](docs/AGENT-BUILD.md) and shared
interfaces in [docs/BUILD-CONTRACT.md](docs/BUILD-CONTRACT.md).

## Context

Two artifacts already exist and this PRD binds them together:

- **The mockup** (`main` branch, merged PR #1): a static Webflow-export landing
  (`index.html`) plus a hand-built manager journey — `login.html` → `space.html`
  (name + website → fake scan) → `editor.html` (steps, branded preview,
  Assets/Design tabs) → `dashboard.html` (Overview, Courses, Tools, Team,
  Analytics, Rewards, Settings) → `brain.html` (canvas-drawn mock graph whose
  own caption says *"mock graph — real graph from Gephi when built"*). All state
  is `localStorage` via `state.js`; every procedure is simulated.
- **The scaffold** (`feature/onboarding-generator` branch): a Next.js app with a
  real pipeline skeleton — `src/lib/crawl` (URL discovery, ranking, HTTP fetch,
  Cloudflare Browser Rendering fallback), `src/lib/pipeline` (stage registry,
  sliced jobs, watchdog), `src/lib/design` (dembrandt + HTML/CSS fallback),
  `src/lib/flow` (FlowSpec schema, scoring, patches), `src/lib/memory`
  (MemoryProvider), Supabase schema + RLS, and the Orthogonal constructor UI at
  `/` talking to `POST /api/orthogonal/*`. The constructor backend
  (`src/services/orthogonal/`) has both `demo.ts` (Lumen mock) and `live.ts`
  (real pipeline bridge). The GymQuest game in the same branch is separate and
  unchanged by this PRD.

This PRD turns the mockup's simulated journey into real procedures inside the
scaffold's architecture.

## Problem

New hires ramp slowly because company knowledge is scattered across the website,
Slack, GitHub, wikis and people's heads. Managers re-explain the same things to
every hire; two hires in the same role finish onboarding knowing different
things. Today the mockup *shows* the fix but nothing it shows is real: the scan
is a timer, the brand is a hash, the brain is 12 hard-coded facts, the tools are
buttons that flip a flag, and the dashboard seeds fake hires.

## Users

- **Manager (primary):** People/L&D or a team lead. Creates the space, scans the
  company site, connects tools, reviews the brain, edits onboarding steps,
  publishes, and watches hires progress.
- **Teammate manager (P1):** a second admin invited into the same space.
- **Hire:** receives the play link, logs in with a company email, plays the
  onboarding. This PRD only specifies their entry points; the game is elsewhere.
- **Build agents (secondary user of this repo):** Devin/Claude sessions that
  implement this PRD in parallel. They consume `AGENTS.md`,
  `docs/BUILD-CONTRACT.md`, `skills/` and `cases/`.

## Goals

1. A manager can go from landing page to a branded, populated space in under
   five minutes without touching a terminal.
2. Every screen the mockup simulated is backed by real data and real procedures:
   real crawl, real brand extraction, real tool reads, real facts in the brain.
3. The company brain is a queryable knowledge graph — entities, facts and edges
   with citations back to the exact source span — that any downstream surface
   (courses, assistant, analytics, the game world) reads through one API.
4. The manager never writes code and never sees a raw error: long work runs as
   resumable pipeline stages with live progress, retries and readable failures.
5. Everything degrades honestly: with no keys the app runs on labelled offline
   stand-ins; with keys it runs the real providers. Nothing silently simulates
   a provider success (existing DECISIONS rule D-7, retained).

## Non-goals (v1)

- The playable world itself, grading/training adapters, xAPI export, and the
  Mubit-model-versioning story (owned by PLAN.md and the other build stream).
- Real-money billing, seats pricing, marketplace listing of the connectors.
- Enterprise SSO (SAML/OIDC), SCIM, audit exports, data-residency guarantees.
- Native mobile apps. The editor preview supports mobile width only.
- Letting agents *write* into customers' tools (post to Slack, open PRs).
  Connections are read-only in v1.

## Manager journey map

```
landing (index)            real marketing page, no Webflow runtime
   └─ login / signup       real auth
        └─ create space    name + company website
             └─ scan       live pipeline: crawl → brand → analyse → brain seed
                  └─ editor    generated steps, branded preview, assets/design
                       └─ dashboard   overview / courses / tools / team /
                                      analytics / rewards / settings
                            ├─ brain    interactive knowledge graph
                            ├─ course   per-course detail
                            └─ publish  play link for hires
```

The constructor UI at `/` (hero → scan → findings → build → workbench) is the
*public teaser* of the same pipeline; a signed-in manager starting a scan opens
the full journey instead of the demo.

## Functional requirements

| ID | Requirement | Priority |
| --- | --- | --- |
| F1 | Public landing page served by this app (replace the static Webflow export): hero, how-it-works, CTA to sign up, no Webflow JS runtime | P0 |
| F2 | Manager sign-up and login: email+password and magic link via Supabase Auth; Google OAuth; redirect new users to space creation, returning users to their dashboard | P0 |
| F3 | Space model: `space` = one company. Owner + manager roles; hires join via invite link or company-email domain match | P0 |
| F4 | Website scan as the existing stage pipeline: robots.txt, sitemap(s), llms.txt, URL ranking, HTTP fetch ≤30 pages, Cloudflare Browser fallback for thin pages, ≤5 screenshots | P0 |
| F5 | Brand identity extraction: logo, favicon, palette, typography, shape language, tone of voice → `brand_profiles` row + design tokens consumed by editor and dashboard | P0 |
| F6 | Content analysis → validated `ProjectModel`-style findings (category, product summary, features, audience, candidate people/terms/rituals) citing crawled URLs | P0 |
| F7 | Live scan UX equal to the mockup: streamed log lines, skeleton page animation, per-step progress, readable error + retry, heartbeat stall detection | P0 |
| F8 | Re-scan from Settings (new scan row, brand profile versioned, downstream stale flags) | P1 |
| F9 | Connector catalog in Tools tab: GitHub, Slack, Notion, Jira/Linear, Google Drive, internal web app, file upload — each with Connect, status, last-synced, error | P0 for GitHub + files; P1 for Slack/Notion/Jira/Drive; P2 for internal web app |
| F10 | Connector ingest: every remote item becomes a `source_item` with provenance (tool, external id, URL, fetched-at, raw ref) → normalized `doc_chunks` | P0 |
| F11 | Incremental sync per connector (cursor stored on the row), manual re-sync, disconnect, per-connector rate/budget caps | P1 |
| F12 | File upload: drag-and-drop PDF/MD/DOCX/TXT into the brain, parsed and chunked like crawled pages | P0 |
| F13 | Internal web app connector: a browser agent logs in with manager-supplied credentials (stored write-only, filled at runtime) and reads the tool's key pages | P2 |
| F14 | Fact extraction from every `doc_chunk`: glossary terms, people, tools, rituals, policies, history, product facts — each `fact` has category, text, confidence and `source_chunk_ids` | P0 |
| F15 | Entity resolution: people/tools/terms deduplicated across sources into canonical `entities` (hard keys first — email, handle, URL — then embedding + LLM tie-break, decision logged) | P0 |
| F16 | Brain review: manager approves / edits / rejects extracted facts; can add facts by hand; rejected facts never resurface | P1 |
| F17 | Brain query API: hybrid search (BM25 + embeddings + 1-hop graph expansion) with citations | P0 |
| F18 | Brain page: interactive web knowledge graph — cluster partitions (People, Glossary, Tools, Rituals, Docs & History), node = entity, click → provenance panel; replaces the canvas mock | P0 |
| F19 | Brain audit: gap flags when a category has thin coverage; facts marked `stale` when their source chunk's document version changes | P1 |
| F20 | Course generation from the brain: a fixed `CourseSpec` JSON (steps from a fixed kind set — welcome, lesson, quiz, scenario, checklist, done) produced by the model, validated by Zod + cross-field rules; model never writes UI | P0 |
| F21 | Editor: steps list, live branded preview, Assets tab (scraped logos/images/copy with "where found"), Design tab (palette, radius, headline style), desktop/mobile toggle — the mockup's editor made real | P0 |
| F22 | Assistant chat: natural-language edits to a course spec → validated patch (existing `src/lib/flow` patches), each applied change logged | P1 |
| F23 | Dashboard Overview: real KPIs (facts learned, team size, courses, on-track rate), hire cards with progress | P0 |
| F24 | Tools tab: connector cards + brain progress bar fed by real counts | P0 |
| F25 | Courses tab: generated curriculum from the brain, "Generate course" via assistant, Publish world → play URL | P0 |
| F26 | Team tab + invite flow: invite by email → hires appear with status `invited` → `onboarding` → `complete` | P1 |
| F27 | Analytics tab: course completion, coins, per-hire progress, knowledge-gap flags (computed from attempts, not hard-coded) | P1 |
| F28 | Rewards tab: catalog + redemption list, funded by a per-space coin budget | P1 |
| F29 | Settings: brand preview, re-scan, space reset (danger zone), manager profile | P0 |
| F30 | AI assistant FAB on dashboard: insights generated from real brain + attempt data | P1 |
| F31 | Publish: space gets a public play URL; hires land on branded login → (handoff to game world) | P0 |
| F32 | Audit log: every agent action, extraction decision, connector sync and manager override is an `audit_events` row | P0 |
| F33 | Offline contract: with no provider keys, crawl/facts/generation use labelled offline stand-ins (existing rule); UI badges say so | P0 |
| F34 | Continuous sync: scheduled re-sync of every connector (cursor-based) and a periodic site re-scan; new/changed/removed source items emit `diff_events` per space | P1 |
| F35 | Self-adapting brain: a changed source doc marks dependent facts `stale`, re-extracts from the new chunks, and re-runs resolution — the knowledge graph updates itself as the company changes; every cascade step is an `audit_events` row | P1 |
| F36 | Downstream propagation: brain changes flow downstream — courses whose `fact_ids` went stale are flagged `needs_refresh` and regenerate on manager confirm; published game content rebuilds from updated `CourseSpec`s (handoff to world stream) | P1 |

## Success metrics

- Landing → published space: a fresh manager completes the full journey in
  < 5 min of wall time and < 10 interactions (counters: timestamps on scans,
  projects, publishes).
- Scan quality on the eval corpus (`cases/`): ≥ 90% of expected sitemap pages
  discovered; brand primary color within a ΔE threshold of ground truth on ≥ 8
  of 10 sites; findings accepted without category errors on ≥ 8 of 10.
- Brain quality: ≥ 40 useful facts per demo company after GitHub + site + 3
  files; < 5% duplicate canonical entities flagged in review; every fact shows
  ≥ 1 citation.
- Pipeline reliability: a failed stage retries with backoff ≤ 3 and surfaces a
  readable error; a stalled job is detected within 60 s and resumable without
  repeating completed work (upsert keys).
- Demo-ready resilience: the whole journey works end to end with `OFFLINE=1`,
  clearly labelled.

## Tech stack

| Layer | Choice | Status | Notes |
| --- | --- | --- | --- |
| App | Next.js (App Router) + TypeScript + Tailwind | Decided | Existing branch. UI components stay client-only where they already are |
| Hosting | Railway (web service + worker + cron) | Decided | Nicole 2026-10-24. Single pane: Next.js service, pipeline worker, scheduled re-sync (F34), and Chromium-capable for dembrandt. `deploy/modal_app.py` stays as fallback. Note: Railway has a one-time trial credit, then Hobby ≈$5/mo — "free" for the demo window, not forever |
| DB | Supabase Postgres + Drizzle + RLS | Decided | Existing schema; pgvector available on Supabase when embedding volume justifies it (D-6: JS cosine is fine below ~10k rows) |
| Auth | Supabase Auth: email+password, magic link, Google OAuth | Decided | Wired already (`(gen)/login`, `auth/callback`); company-email domain match for hires P1 |
| Storage | Supabase Storage | Decided | Buckets exist for pages/screenshots/assets |
| Crawl | In-repo crawler: robots, sitemap, llms.txt, URL rank, HTTP fetch, cheerio → markdown (turndown) | Decided | `src/lib/crawl`; add firecrawl.dev as optional provider if a site defeats it |
| Browser rendering | Cloudflare Browser Rendering for thin/JS pages | Decided | Already integrated; free plan ≈ 10 min/day, cached crawl reuses for 24 h |
| Brand extraction | dembrandt (local Chromium) + LLM normalization into tokens | Decided | Exists; needs a Chromium-capable host — Railway/Modal, not Vercel functions |
| LLM | Anthropic via Mubit gateway (`MUBIT_*` envs) | Decided | Fixed system prompts in `src/lib/prompts.ts`; everything variable in the user message |
| Embeddings | `MUBIT_EMBED_MODEL` (hackathon sponsor) primary; Voyage AI (`VOYAGE_API_KEY`) as standby if Mubit can't serve embeddings; offline hashed fallback | Decided | Nicole 2026-10-24. Dimension recorded on the space so the provider can swap |
| Tool OAuth | Nango (open-source OAuth/token broker) for Slack/Notion/Jira/Drive; direct OAuth app or fine-grained PAT for GitHub | Decided | Nicole 2026-10-24. Self-hostable, free cloud tier for the demo |
| Internal-web-app browsing | Browserbase + Stagehand | Proposed | P2; credentials write-only in Supabase Vault, filled at runtime, never shown back |
| Knowledge graph store | Postgres tables (`entities`, `edges`, `facts`, `mentions`) | Decided | A graph DB (SurrealDB/Neo4j) is overkill at this volume; schema keeps a migration path |
| Brain graph viz | cosmos.gl | Decided | Nicole 2026-10-24 — GPU-canvas force graph, propadm.in's pick. sigma.js + Graphology stays the documented fallback if cosmos.gl disappoints. Gephi desktop stays an offline analysis/export tool, never a runtime dep |
| Pipeline/jobs | Existing sliced pipeline (`jobs`, `job_events`, stage registry, heartbeat watchdog) | Decided | Reuse for connector syncs and course generation; Inngest/Trigger.dev only if we outgrow it |
| Email | Resend (invites, notifications) | Proposed | Any transactional sender works; only invites v1 |
| Analytics | PostHog | Proposed | propadm.in used it; product + agent-tracing events |
| Error tracking | Sentry | Proposed | |
| CI | GitHub Actions | Decided | Exists: lint, typecheck, unit tests, build on every push; add Playwright e2e workflow |
| Secrets | Env vars + `.env.example` mirror; Supabase Vault for customer credentials | Decided | No secrets in the repo, ever |

## Tools and services to provision

Actionable checklist — each row becomes an env-var group and a `check:env` entry:

| Tool | For | Needed at | Setup |
| --- | --- | --- | --- |
| Railway | Web + worker + cron hosting | Phase 0 — Decided | Project, `RAILWAY_TOKEN`, link repo. Trial credit first; `deploy/modal_app.py` stays as fallback |
| Supabase | DB, auth, storage, Vault | Phase 0 | Already bootstrapped (`supabase:bootstrap`); add `pgvector` extension, storage bucket `crawl-artifacts` |
| Google Cloud / OAuth | Google sign-in, Drive connector | Phase 0 / P1 | OAuth client; `SUPABASE_AUTH_GOOGLE_*` |
| GitHub OAuth app | GitHub connector | Phase 3 | Or accept fine-grained PATs for demos |
| Nango | Slack/Notion/Jira/Drive OAuth | Phase 3 (P1) — Decided | `nango.dev` free cloud tier or self-host; `NANGO_SECRET_KEY` |
| Cloudflare Browser Rendering | JS-heavy site crawl + screenshots | Phase 1 | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (already in env spec) |
| Mubit gateway | All LLM calls | Phase 1 | `MUBIT_API_KEY`, `MUBIT_ENDPOINT`, gateway flag |
| Anthropic | Direct LLM fallback | Phase 1 | `ANTHROPIC_API_KEY`, model + effort envs |
| Voyage AI | Embeddings standby | Phase 4 | `VOYAGE_API_KEY` — only provisioned if `MUBIT_EMBED_MODEL` can't serve embeddings |
| Browserbase | Internal web app connector | P2 | `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` |
| cosmos.gl | Brain page | Phase 4 — Decided | npm only — `@cosmos.gl/graph`; `sigma` + `graphology` fallback noted in skill |
| Gephi | Offline brain analysis/demos | Optional | Desktop app; export `graph.gexf` from the brain API for offline review |
| Resend | Invite emails | Phase 6 | `RESEND_API_KEY`, `FROM_EMAIL` |
| PostHog | Product analytics | Phase 6 | `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_HOST` |
| Sentry | Errors | Phase 6 | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` |
| Context7 MCP | Library docs for build agents | Always | See `AGENTS.md`; used by Devin/Claude, not the product |
| Playwright MCP | UI verification for build agents | Always | Used by the `verify-ui` skill and e2e |

## Mockup → real mapping

| Mockup element | Simulated today | Real procedure |
| --- | --- | --- |
| `index.html` | Webflow export | Rebuilt in-app (or kept static behind `/` redirect); CTAs → real auth |
| `login.html` | localStorage users, fake Google/Apple pickers | Supabase Auth flows; work-email SSO path hidden until SAML |
| `space.html` scan | `SCAN_STEPS` timer, `brandFromWebsite()` hash → palette | Live pipeline stages streaming `job_events`; brand from dembrandt + LLM |
| `editor.html` | Hard-coded `STEPS`, static assets list, color inputs | CourseSpec from brain; Assets tab lists real scraped assets with source URLs; Design tab edits `brand_profiles` tokens |
| `dashboard.html` Overview | `seedDemoHires()` | `dashboard` aggregate endpoints over `hires`, `facts`, `courses` |
| Tools tab | Flag-flip `connectTool()` | Connector rows with real OAuth/sync; brain bar = `facts` count |
| `brain.html` | Seeded-random canvas clusters | cosmos.gl over `entities`/`edges` API; provenance side panel |
| `course.html` | `OB.COURSES` constant | `courses` table; lessons from `CourseSpec` |
| Assistant FAB | Canned insights list | Answers from brain query + attempt aggregates |
| `play.html` link | `?space=` param | Published space slug → branded hire login → game world handoff |

## Subsystem: landing page

`src/app/(site)/` — server-rendered marketing page. Sections mirror the Webflow
page's content (hero, value props, how it works, CTA) but built with the app's
own tokens and no Webflow JS. CTA: "Build my onboarding" → `/login?next=/space/new`.
Keep `index.html` served at `/classic` for reference until F1 ships.

## Subsystem: auth and spaces

- Supabase Auth is the only auth. `profiles` row per user (name, avatar).
- `spaces` has `owner_id`, `slug`, `host`, `status
  (created|scanning|ready|error)`, `brand_profile_id`.
- `space_members(space_id, user_id, role)` with roles `owner`, `manager`,
  `hire`. RLS: members read their space; only owner/manager write.
- First login with no membership → create-space flow (`/space/new`). Login with
  membership → `/dashboard`.
- Hire invite: `hire_invites(email, space_id, token)`; the play link signs them
  up as role `hire` bound to that space.

## Subsystem: scan pipeline

Reuse `src/lib/pipeline` verbatim. Stage order for a space scan:

`crawl → extract_design → analyse → seed_brain → generate_courses → ready`

- `crawl` (exists): URL discovery, ranking, fetch, screenshots → `crawl_pages`.
- `extract_design` (exists): dembrandt → raw evidence → LLM-normalized
  `brand_profiles` (palette with roles, typography, shape notes, logo refs,
  voice descriptors).
- `analyse` (exists, extend): findings JSON + **brain seeds**: candidate
  entities/facts written as `status=draft` with citations.
- `seed_brain` (new stage): entity resolution pass on the scan's candidates —
  merge into canonical `entities`, write `facts` with `source_chunk_ids`.
- `generate_courses` (new stage, one slice per course): `CourseSpec` drafts.
- `ready`: memory reflection + dashboard unlock.

The scan screen shows `job_events` (Supabase Realtime + poll fallback) —
the mockup's `SCAN_STEPS` become real log lines. Failures: stage retry ×3 with
backoff, then readable error + Retry; heartbeat stall >60 s → Resume.

## Subsystem: tool connectors

`connectors` rows drive everything; a connector is `{type, status, auth_ref,
cursor, last_synced_at, error}`.

| Connector | Read | Auth | Items → `source_items` |
| --- | --- | --- | --- |
| `github` | repos (README, CONTRIBUTING, docs/), org members, open/closed PR+issue titles | OAuth app or fine-grained PAT | doc, issue, pr |
| `slack` | public-channel history (n days), channel list, custom emoji names | Nango OAuth | message batches |
| `notion` | pages+databases in the shared wiki | Nango OAuth | doc |
| `jira`/`linear` | projects, issue summaries, board names | Nango OAuth | issue |
| `drive` | selected folders: Docs/Slides/PDFs | Nango OAuth | doc/file |
| `webapp` | key pages of an internal tool | Browserbase session + Vault creds | page |
| `files` | uploaded PDF/MD/DOCX/TXT | — | file |

Every connector writes `source_items` then `doc_chunks`; the brain builder
(F14/F15) runs per connector batch. Sync runs through the same job pipeline,
one stage `sync_connector` per connector, resumable by cursor. A connector's
status machine: `pending → authing → syncing → ready | error | stale`.

## Subsystem: company brain

Tables: `entities`, `edges`, `facts`, `entity_mentions`, `doc_chunks`,
`source_items`. Entity types: `person`, `tool`, `term`, `ritual`, `policy`,
`product`, `org_unit`, `doc`. Edge relations: `owns`, `uses`, `mentions`,
`related_to`, `depends_on`.

- Extraction runs per chunk batch through the LLM with a fixed system prompt;
  output validated (fact = `{category, text, entity_names[], confidence,
  span}`). Confidence < threshold → `draft`.
- Resolution: hard keys (email, GitHub login, channel name, URL) → candidate
  entities; ties broken by embedding similarity, then an LLM adjudication call
  whose decision is written to `audit_events`.
- Review UI (Brain → Review): list of `draft` facts, approve/edit/reject; edit
  rewrites `text` and keeps provenance; reject sets `status=rejected` and the
  extractor is told not to re-propose it (negative examples in the prompt).
- Brain API: `GET /api/brain/graph?space=` → nodes+edges for cosmos.gl;
  `GET /api/brain/search?q=` → hybrid results with citations;
  `GET /api/brain/facts?status=`; mutations under `/api/brain/facts/:id`.
- Brain page (cosmos.gl): GPU force layout over partitions, node size = mention
  count, click → side panel with fact text + cited source links. Manager can
  export `graph.gexf` for offline Gephi inspection.
- Self-adaptation (F34/F35): every connector cursor tick and re-scan emits
  `diff_events`; a doc version change marks dependent facts `stale`, queues
  re-extraction on the new chunks, and re-runs resolution — so the brain page
  drifts as the company drifts. F36 then flags affected courses
  `needs_refresh` and rebuilds published game content from the updated
  `CourseSpec`s.

## Subsystem: courses and editor

- `CourseSpec` (new, mirrors FlowSpec): `{title, icon, building, game,
  steps: Step[]}` where `Step.kind ∈ {welcome, fields, lesson, quiz, scenario,
  checklist, done}`. Steps reference `fact_ids` they teach; validation requires
  every teaching step to cite ≥1 approved fact.
- `generate_courses` produces one spec per pack type from the brain
  (`company`, `people-culture`, `tools-stack`, `hard-conversations` default
  four matching the mockup's COURSES).
- Editor = real version of `editor.html`: steps list from `courses.spec`,
  preview pane renders the actual `StepRenderer` component (shared with the
  future game), Assets tab lists `source_items` of kind asset/screenshot with
  their URLs, Design tab edits `brand_profiles` tokens (versioned; edits bump
  `tokens_version` and mark courses `stale`).
- Assistant edits → `PATCH /api/courses/:id` with `{op, path, value}` patches
  validated the same way generation is.

## Subsystem: dashboard

Every tab reads aggregate endpoints (`/api/spaces/:id/overview`, `/courses`,
`/connectors`, `/hires`, `/analytics`) — no client-side fabrication. Empty
states follow the mockup's copy. The FAB assistant answers from brain search +
attempt aggregates; "Generate course" opens the F22 flow.

## Publish and play handoff

`POST /api/spaces/:id/publish` → `published_at`, public slug
`/s/:slug`. The hire entry renders the space's brand tokens and a company-email
login; after auth it hands off to the game world with `{spaceId, hireId,
courseSpecIds[]}` — the contract the other build stream consumes.

## Data model

```ts
profiles        { id, name, avatar_url }
spaces          { id, owner_id, name, slug, host, status, brand_profile_id,
                  published_at, created_at }
space_members   { space_id, user_id, role: 'owner'|'manager'|'hire' }
scans           { id, space_id, url, status, progress, log jsonb, page_count,
                  error, created_at }
crawl_pages     { id, scan_id, url, title, text, artifact_ref, screenshot_ref,
                  fetched_at }
brand_profiles  { id, space_id, scan_id, palette jsonb, typography jsonb,
                  logo_refs jsonb, voice, tokens_version, created_at }
connectors      { id, space_id, type, status, auth_ref, cursor,
                  last_synced_at, error }
source_items    { id, space_id, connector_id, kind, external_id, url, title,
                  raw_ref, meta jsonb, fetched_at }
doc_chunks      { id, source_item_id, idx, text, embedding jsonb, tokens }
entities        { id, space_id, type, name, aliases, fields jsonb, version,
                  merged_into }
edges           { id, space_id, source_id, target_id, relation, evidence,
                  rule, version }
entity_mentions { id, entity_id, chunk_id, span, confidence }
facts           { id, space_id, entity_id, category, text, confidence,
                  source_chunk_ids uuid[], status, created_by, created_at }
courses         { id, space_id, title, icon, building, game, spec jsonb,
                  status: 'draft'|'published'|'stale'|'archived', version }
hires           { id, space_id, email, name, status, joined_at }
attempts        { id, hire_id, course_id, step_id, result jsonb, score,
                  created_at }
rewards         { id, space_id, name, cost_coins, active }
redemptions     { id, reward_id, hire_id, status, created_at }
hire_invites    { id, space_id, email, token, accepted_at }
audit_events    { id, space_id, actor, kind, payload jsonb, created_at }
jobs, job_events                                — existing pipeline tables
```

## API surface

| Area | Endpoints |
| --- | --- |
| Scans | `POST /api/orthogonal/scans`, `GET /api/orthogonal/scans/:id` (existing contract); `POST /api/spaces/:id/rescan` |
| Spaces | `POST/GET/PATCH /api/spaces`, `POST /api/spaces/:id/publish`, `GET /s/:slug` |
| Connectors | `GET/POST /api/spaces/:id/connectors`, `POST /api/connectors/:id/sync`, `DELETE /api/connectors/:id`, OAuth callbacks `/api/connectors/:type/callback` |
| Files | `POST /api/spaces/:id/files` (multipart → storage + source_items) |
| Brain | `GET /api/brain/graph`, `GET /api/brain/search`, `GET/POST/PATCH /api/brain/facts`, `GET /api/brain/graph.gexf` |
| Courses | `GET/POST /api/spaces/:id/courses`, `PATCH /api/courses/:id`, `POST /api/courses/:id/publish` |
| Hires | `POST /api/spaces/:id/invites`, `GET /api/spaces/:id/hires` |
| Dashboard | `GET /api/spaces/:id/overview`, `GET /api/spaces/:id/analytics` |
| Constructor | `POST /api/orthogonal/projects|push|publish` (existing) |

Validation: zod at every boundary; errors `422` validation, `404` missing,
`409` stale writes (version columns), `401/403` auth, `503` unconfigured
provider.

## Repo layout (target)

```
onBoardGameHack/
├── PRD.md, AGENTS.md, PLAN.md, DECISIONS.md, README.md
├── docs/
│   ├── BUILD-CONTRACT.md      # interfaces parallel agents must not break
│   ├── AGENT-BUILD.md         # multi-agent process (modeled on propadm.in)
│   └── onboarding-studio.md   # existing studio doc
├── skills/                    # build skills, one folder per skill (SKILL.md)
├── cases/                     # eval corpus: real sites to scan + expected output
├── src/
│   ├── app/(site)/            # landing page
│   ├── app/(gen)/             # auth'd app: login, space, scan, studio
│   ├── app/(dash)/            # dashboard, editor, brain, course pages
│   ├── app/api/…              # surface above
│   ├── components/{dash,editor,brain,assistant}
│   ├── lib/{crawl,pipeline,design,flow,memory,brain,connectors}
│   └── services/orthogonal/   # constructor backend (demo + live)
├── world/                     # game world (other stream)
├── deploy/modal_app.py        # fallback deploy path (Railway is primary)
└── supabase/migrations/       # schema + RLS + storage
```

## Offline and demo contract

- `OFFLINE=1` (or missing keys): deterministic stand-ins for crawl, LLM,
  embeddings; UI shows an "offline" badge wherever data is simulated. Existing
  `src/services/orthogonal/demo.ts` stays as the no-signup demo.
- `npm run demo:reset` restores the seeded demo space (Acme).
- No silent provider simulation: an unconfigured provider returns `503`, not
  fabricated data (BUILD-CONTRACT rule).

## CI/CD

- GitHub Actions on every push: lint, typecheck, `vitest`, `next build`
  (exists); add Playwright e2e on PR.
- Deploy: one `deploy` workflow per hosting decision (Railway service deploys
  on merge to `feature/onboarding-generator`; Modal workflow already exists).
- DB migrations run in CI against the preview Supabase project before deploy.

## Implementation plan

Phases in dependency order; each ends in something demoable. Backlog format
(ID/Depends/Acceptance/Owner/Mode) lives in [docs/AGENT-BUILD.md](docs/AGENT-BUILD.md).

**Phase 0 — foundations**
- [ ] This doc set merged; branch protection + PR conventions agreed
- [x] Deploy target decided: **Railway** (web+worker+cron); Modal kept as fallback — env matrix written to `.env.example`
- [ ] `npm run check:env` covers every row in the provisioning table
- [ ] Seed demo company (Acme Pay content already exists under `content/`)

**Phase 1 — landing, auth, spaces**
- [ ] Landing page in-app; `/classic` keeps Webflow export
- [ ] Supabase Auth sign-up/login/Google; `profiles`, `spaces`, `space_members`, RLS
- [ ] Create-space flow (name + website) → scan kicked off

**Phase 2 — real scan**
- [ ] `crawl` → `crawl_pages` + screenshots (exists; wire to space)
- [ ] `extract_design` → `brand_profiles` v1; editor+dashboard consume tokens
- [ ] `analyse` → findings + draft brain seeds; live scan UI on `job_events`
- [ ] Re-scan path and error/stall states

**Phase 3 — connectors**
- [ ] `source_items`/`doc_chunks` schema + file upload connector
- [ ] GitHub connector (OAuth or PAT) — first real tool
- [ ] Slack/Notion/Jira/Drive via Nango (P1)
- [ ] Sync pipeline stage, cursors, status machine, disconnect

**Phase 4 — brain**
- [ ] `entities`, `edges`, `facts`, `entity_mentions` schema
- [ ] Extraction prompt + validation; resolution (keys → embedding → LLM)
- [ ] Review UI; brain search API; cosmos.gl brain page; GEXF export
- [ ] Stale-fact marking on source changes; `diff_events` cascade (F34/F35)

**Phase 5 — courses + editor**
- [ ] `CourseSpec` schema + validation; `generate_courses` stage
- [ ] Editor (steps, preview, assets, design, d/m toggle) on real data
- [ ] Assistant patches; publish → `/s/:slug`

**Phase 6 — dashboard + polish**
- [ ] All tabs on aggregate endpoints; invites; analytics; rewards
- [ ] `needs_refresh` cascade into courses + published world rebuild (F36)
- [ ] FAB assistant on brain search; PostHog + Sentry; e2e suite green
- [ ] `cases/` corpus + eval runner producing `ANSWERS/<site>/RESULT.md`

## Risks and fallbacks

| Risk | Fallback |
| --- | --- |
| dembrandt/Chromium can't run on chosen host | HTML+CSS fallback already exists; mark tokens `partial` |
| Slack/Jira app review takes days | GitHub + files prove the connector path; other cards show "Coming soon" with real status |
| Manager uploads huge docs | 5 MB cap, background chunk job, clear progress |
| LLM extraction produces junk facts | Draft queue + confidence threshold; nothing enters the brain without `approved` (default: auto-approve ≥ 0.9, configurable) |
| Browser creds connector is risky | P2 only, write-only Vault storage, per-space audit |
| Crawl blocked by WAF | Cloudflare browser fallback; manual URL/file add never blocked |
| Railway free-tier limits bite mid-demo | Hobby tier ≈$5/mo after trial credit; `deploy/modal_app.py` fallback stays green |
| Two agents collide on shared files | BUILD-CONTRACT names the seams; PRs are small and one-concern |

## Open questions for Nicole

Decided 2026-10-24:

1. Deploy target → **Railway** (web+worker+cron). Modal stays fallback.
   Caveat: trial credit, then ≈$5/mo Hobby — free for the demo window only.
2. Tool OAuth → **Nango** (free cloud tier / self-host) for Slack/Notion/Jira/
   Drive; GitHub keeps a direct OAuth/PAT path.
3. Brain viz → **cosmos.gl**. sigma.js + Graphology remains the fallback.
4. Embeddings → **Mubit** (`MUBIT_EMBED_MODEL`) primary; Voyage AI standby.
5. Self-adapting structure → **required** (F34–F36): the brain, courses and
   the game must update automatically as the company's sources change.

Still open:

6. Auto-approve threshold for facts: default 0.9 — accept, or require manual
   review of everything (slower but fully supervised)?
