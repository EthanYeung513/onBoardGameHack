# Multi-agent build process

How this repo is built by many agents (Devin sessions, Claude Code, humans)
working in parallel without stepping on each other. Modeled on
[Fergus-MW/propadm.in](https://github.com/Fergus-MW/propadm.in) — the reference
implementation of agentic building we are copying.

## What propadm.in does that we are copying

Structure, copied almost 1:1:

| propadm.in | Ours | Purpose |
| --- | --- | --- |
| `PRD.md` (927 lines) | `PRD.md` | One source of truth: problem, users, goals, non-goals, F-numbered requirements with P0/P1/P2, success metrics, tech-stack table with **Decided/Proposed** status, field-level data model, API surface, phased implementation plan, risks |
| `AGENTS.md` | `AGENTS.md` | Short rules every agent reads first: single dev entry point, test/PR rules, file-size limit (1,000 lines), Context7 for library docs |
| `docs/BUILD-CONTRACT.md` | `docs/BUILD-CONTRACT.md` | The seams: shared types, endpoint shapes, status machines. Parallel agents build different subsystems against them |
| `skills/` (22 folders, one `SKILL.md` each) | `skills/` | Reusable procedures, one folder per skill |
| `docs/MCP.md` — one MCP server only | `docs/BUILD-CONTRACT.md` §seams | Agents reach data through the app's API surfaces, not ad-hoc DB access |
| `Property Management/NNN` case corpus + `ANSWERS/` | `cases/` | A corpus of real inputs + expected outputs; an eval runner writes results per case, propadm.in's "Reality Test" style |
| `design.md` + `propadmin-design-system/` | Mockup pages on `main` + `brand_profiles` tokens | Design rules live in a doc; visual spec is extracted, not vibes |
| `DECISIONS.md` convention | `DECISIONS.md` (exists) | Every non-obvious choice logged: Task / Time / Context / Options / Chosen / Why / Reversibility / Revisit |
| `TODO.md` + numbered PRs | Backlog table below + PR conventions | Ordered, dependency-tracked work items agents can claim |

How propadm.in actually got built (from its git history, 33 commits, ~2 days):

1. **Bootstrap first**: `first commit` → one large `Build property operations
   stack and verify local end-to-end flows` commit — the skeleton and shared
   core landed before any feature.
2. **Small numbered PRs after that**: ~30 pull requests, each exactly one
   concern ("Add PostHog analytics", "Enable Claude extraction across
   production ingestion services", "Make the admin agent a ChatGPT-style chat
   with threads"), authored by four humans plus `devin-ai-integration[bot]`.
3. **Docs and media are first-class**: README rewrite, architecture loop,
   LICENSE and demo recordings landed as their own PRs (#16, #20, #24).
4. **A mid-course migration was one PR**: "Move shared state to SurrealDB and
   ship workflow corpus/tuning work" (#23) — big change, still a single
   reviewable unit, because the contract doc held the seams.
5. **Eval was a feature, not an afterthought**: the 50-case corpus, the
   `ANSWERS/` reality-test outputs, and the workflow-tuning eval were committed
   alongside the code they test.

## Roles and claiming

Work is claimed through the backlog table in each phase section of `PRD.md`
(checkboxes) and this file's task ledger. Rules:

- One agent = one task at a time. Claim by assigning yourself in a comment on
  the tracking PR/issue, or by being the named owner in the task row.
- `auto` tasks need no external keys or judgement calls — safe for unattended
  agents. `human` tasks need a key, an OAuth approval, a product decision or an
  outward action — do not start them silently.
- Product decisions (non-goals, thresholds, deploy target, anything marked
  **Proposed**) go to Nicole. Agents choose within Decided rows only.

## Backlog format

Same shape as PLAN.md §11 (which this supersedes for the site work):

| ID | Task | Depends | Acceptance | Owner | Mode |
| --- | --- | --- | --- | --- | --- |
| S1 | Doc set merged (this PR) | — | PRD + AGENTS + contracts on `feature/onboarding-generator` | Nicole | human |
| S2 | Landing page in-app | S1 | `/` serves the mockup landing verbatim (burger, animations); Log in → `/login` (D-18) | done (#4, fix-up) | auto |
| S3 | Auth + spaces + roles | S1 | Signup/login/Google; create-space row; `requireRole` checks | done (#5) | auto |
| S4 | Scan → brand_profiles + draft brain | S3 | Real scan of a public site fills `crawl_pages`, `brand_profiles` (+ candidates), website `source_items` | in progress (`feat/scan-stages`) | auto |
| S5 | Scan UI live | S4 | space.html scan step on `job_events`; retry/stall states | in progress (`feat/scan-screen`) | auto |
| S6 | File-upload connector | S3 | Dropped PDF/MD/DOCX/TXT lands as `source_items` + `doc_chunks` | in progress (`feat/connectors`) | auto |
| S7 | GitHub connector | S6 | PAT connect → repos/docs/members/PRs ingested; README edit → changed → stale step | in progress (`feat/connectors`) | auto |
| S8 | Brain schema + extraction + resolution | S6 | `seed_brain` + `cascade` stages; facts with citations; dedupe logged | in progress (`feat/brain-extraction`) | auto |
| S9 | Brain review UI | S8 | Approve/edit/reject facts; manual add | — | auto |
| S10 | Brain page (cosmos.gl) | S8 | brain.html on the real graph; provenance panel; GEXF; stale facts visible | in progress (`feat/brain-page`) | auto |
| S11 | CourseSpec + generate_courses | S8 | Valid specs citing approved facts; step ids; `regenerateSteps` | in progress (`feat/course-generation`) | auto |
| S12 | Editor on real data | S11 | editor.html: steps/preview/assets/Design tab (F37) ; patches validate; stale steps refreshable | in progress (`feat/editor`) | auto |
| S13 | Dashboard real data | S3, S11 | dashboard.html tabs on aggregate queries; zero fabricated data | in progress (`feat/dashboard`) | auto |
| S14 | Invites + play handoff | S13 | Email → hire role → `/s/:slug` → game handoff payload | — | auto |
| S15 | Slack/Notion/Jira/Drive via Nango | S7 | Synced via Nango proxy → diff_events → stale course steps (F38); unconfigured integrations listed for a human | in progress (`feat/connectors`) + human (Nango integration setup) | human |
| S16 | Eval corpus `cases/` + runner | S4 | ≥10 sites, `ANSWERS/<site>/RESULT.md`, metrics vs PRD | — | auto |
| S17 | Railway/Modal production deploy | S3 | Public URL, env matrix filled | — | human (account) |
| S18 | Internal web app connector (Browserbase) | S7 | Write-only creds → browsed pages ingest | — | human (creds) |
| S19 | Learned brand recommendations via Mubit (F37) | S4 | `brand_decisions` evidence; `brand.options`/`brand.decide`; Mubit `brand.recommend` task + feedback + memory; `npm run eval:brand` first-time-right before/after | in progress (`feat/brand-learning`) | auto |
| S20 | Mubit integrity (F39) | — | All LLM/embedding calls via `src/llm/mubit.ts`; guard test | done (#9) | auto |
| S21 | `check:env` covers every provisioned service | — | One real call per service incl. Mubit memory/feedback + Nango integrations | in progress (`feat/check-env`) | auto |
