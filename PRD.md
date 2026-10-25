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
  (MemoryProvider), a database + auth layer (Supabase-based — being replaced
  by Convex, see Tech stack), and the Orthogonal constructor UI at
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
| F1 | Public landing page served by this app: the mockup `index.html` exactly (nav, burger, animations); Log in → real auth; no invented CTAs or demo surface | P0 |
| F2 | Manager sign-up and login: email+password and magic link via Convex Auth; Google OAuth; redirect new users to space creation, returning users to their dashboard | P0 |
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
| F37 | Design tab with learned brand recommendations: the editor's Design tab (primary, accent, radius, headline style) shows the extracted candidates with the recommended option first; every manager pick is stored as evidence (`brand_decisions`: candidates, features, recommended vs chosen, company profile); recommendations for a NEW company rank candidates from that history so the recommended option is right the first time; the recommendation, feedback (approve/correct by Mubit request id) and memory all run through the Mubit adapter — the flagship Mubit use case (Nicole 2026-10-25) | P0 |
| F38 | Course steps self-update from live tool signal: Slack messages, Jira tickets, Notion/Drive docs and GitHub changes become `diff_events` → stale facts in the brain → the exact course **steps** teaching them are flagged (`courses.staleStepIds`) and refreshable step-by-step; the audit trail reads source → fact → course → step (Nicole 2026-10-25) | P0 |
| F39 | Mubit integrity: every LLM + embedding call goes through `src/llm/mubit.ts` (OpenAI-compatible, `MUBIT_*`, gpt-* only, task-tagged, request ids kept); no Mubit key ever reaches an Anthropic path; a test guards it (D-30) | P0 |
