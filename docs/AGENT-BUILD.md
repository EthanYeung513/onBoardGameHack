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
| `design.md` + `propadmin-design-system/` | Mockup pages (tag `archive/main-mockup`) + `brand_profiles` tokens | Design rules live in a doc; visual spec is extracted, not vibes |
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

| ID | Task | Depends | Acceptance | Status (2026-10-25) | Mode |
| --- | --- | --- | --- | --- | --- |
| S1 | Doc set merged | — | PRD + AGENTS + contracts on `feature/onboarding-generator` | done (#2) | human |
| S2 | Landing page in-app (F1) | S1 | `/` serves the mockup landing verbatim (burger, animations); Log in → `/login`; real four-squares mark (D-18) | done (#4, #6, #16) | auto |
| S3 | Auth + spaces + roles (F2, F3) | S1 | Email+password + Google (Convex Auth); create-space; `requireRole`; Apple out of scope (D-31) | done (#5, #14) | auto |
| S4 | Scan stages: crawl → extract_design → analyse (F4–F6, F8) | S3 | Real scan fills `crawl_pages`, `brand_profiles` (+ candidates), website `source_items`, findings | in-flight (`feat/scan-stages`) | auto |
| S5 | Scan UI live (F7) | S4 | space.html scan step on `job_events`; retry/stall/waiting states; `?rescan=1` | done (#12) | auto |
| S6 | File-upload connector (F12) | S3 | PDF/MD/DOCX/TXT ≤5 MB → `source_items` + `doc_chunks` | in-flight (`feat/connectors`) | auto |
| S7 | GitHub connector (F9–F11) | S6 | PAT → repos/docs/members/PRs; incremental sync; README edit → changed → stale step | in-flight (`feat/connectors`) | auto |
| S8 | Brain extraction + resolution + cascade (F14, F15, F17, F35) | S6 | `seed_brain` + `cascade` stages; cited facts; dedupe logged; hybrid search; fact mutations | in-flight (`feat/brain-extraction`) | auto |
| S9 | Brain review UI (F16) | S8 | Approve/edit/reject/add facts on the S8 mutations; draft queue; stale facts surfaced | queued — starts when S8 merges | auto |
| S10 | Brain page, cosmos.gl (F18, F19) | S8 | brain.html on the real graph; provenance panel; GEXF; stale facts visible | in-flight (`feat/brain-page`) | auto |
| S11 | CourseSpec + generate_courses + step refresh (F20, F36, F38) | S8 | Valid specs citing approved facts; step ids; `regenerateSteps` | in-flight (`feat/course-generation`) | auto |
| S12 | Editor on real data + Design tab (F21, F37) | S11, S19 | editor.html: steps/preview/assets/Design (recommended first); patches validate; stale steps refreshable | in-flight (`feat/editor`) | auto |
| S13 | Dashboard on real data (F23–F30) | S3, S11 | dashboard.html tabs on aggregate queries; invites (link); rewards; settings; FAB; zero fabricated data | in-flight (`feat/dashboard`) | auto |
| S14 | Invites by email + publish + hire entry `/s/:slug` (F26, F31) | S13 | Resend invite email → hire role; publish → play URL; play.html branded login → game handoff `{spaceId, hireId, courseSpecIds}` | queued — starts when S13 merges | auto |
| S15 | Slack/Notion/Jira/Drive via Nango (F9, F34, F38) | S7 | Nango proxy sync → diff_events → stale course steps; cron re-sync | in-flight (`feat/connectors`) + **human: create the Slack/Jira/Notion/Drive integrations in Nango** | human |
| S16 | Eval corpus `cases/` + runner | S4 | ≥10 sites, `ANSWERS/<site>/RESULT.md`, metrics vs PRD | queued — starts when S4 merges | auto |
| S17 | Production deploy: Vercel (web) + Modal (worker/cron) + Convex cloud | S3 | Public URL; env matrix; `SITE_URL` on rapid-mosquito-655; worker on Modal | queued — **needs owner go-ahead (outward deploy)** | human |
| S18 | Internal web app connector, Browserbase (F13, P2) | S7 | Write-only creds → browsed pages ingest | queued — **blocked: no Browserbase keys provisioned** | human |
| S19 | Learned brand recommendations via Mubit (F37) | S4 | `brand_decisions` evidence; `brand.options`/`decide`; Mubit `brand.recommend` + feedback; `npm run eval:brand` | in-flight (`feat/brand-learning`) | auto |
| S20 | Mubit integrity (F39) | — | All LLM/embedding calls via `src/llm/mubit.ts`; guard test | done (#9) | auto |
| S21 | `check:env` covers every provisioned service | — | One read-only call per service | done (#11) | auto |
| S22 | Course detail page `course.html` (F25) | S11 | `/course?id=` on the real CourseSpec: outcomes, plan, stale steps, regenerate on confirm | queued — starts when S11 merges | auto |
| S23 | Assistant edits + "Generate course" via assistant (F22, F25) | S11, S12 | NL → validated CourseSpec patches through Mubit; every change logged | queued — starts when S12 merges | auto |
| S24 | PostHog + Sentry instrumentation | S13 | Product events + agent tracing; errors to Sentry | queued — after S13; **human: replace `SENTRY_DSN` (holds an auth token)** | auto |
| S25 | CI: lint/typecheck/test/build + Convex codegen check + Playwright e2e | — | GitHub Actions green on every PR; e2e on a Docker Convex backend | in-flight (`feat/ci`) | auto |
| S26 | `demo:reset` + seeded demo company on Convex | S8, S11 | Acme Pay from `content/` through the real pipeline (offline-labelled without keys) | queued — after S8 + S11 | auto |
| S27 | README + demo media (`skills/readme-and-media`) | most | Judge-ready README, architecture, recordings | queued — last | auto |
| S28 | Retire legacy Supabase studio + `src/lib/llm/client.ts` (P2) | S27 | Studio removed or migrated; no Supabase deps | queued — after the demo | auto |

## Branch and PR conventions

- Everything lands on `feature/onboarding-generator` via PR; branches are
  `feat/<slug>` / `fix/<slug>` / `docs/<slug>` / `skill/<slug>`.
- PRs are small and single-concern (propadm.in averaged ~15 commits/day but
  each PR was one idea). A PR that touches two subsystems gets split unless the
  contract seam changed.
- PR body: what/why, the contract sections touched, test commands + results,
  screenshot or recording for any UI change.
- Commit identity: `Faisal Lawan <faisallawan08@gmail.com>` (see AGENTS.md).

## Decisions log

Non-obvious choices go in `DECISIONS.md` as `D-n` entries (format exists there):
Task · Time · Context · Options · Chosen · Why · Reversibility · Revisit.
A decision that closes a **Proposed** PRD row also edits the PRD's Status
column to `Decided` in the same PR.

## Skills

`skills/` holds build skills — reusable procedures an agent follows when it
hits that kind of work (add a pipeline stage, add a connector, verify a UI
change). One folder per skill with a `SKILL.md` whose frontmatter carries
`name` and `description`. Write a new skill when the same procedure is about to
be done a third time, or when a session discovers a non-obvious environment
gotcha (like the Node PATH or the git wrapper). Runtime agent skills for
the product itself are out of scope for now; if they arrive they live under
`skills/product/`.

## Eval corpus

`cases/` holds real scan targets so the pipeline's quality is measured, not
vibes: `cases/<site-slug>/` contains `input.md` (URL, what to expect) and
`expected.md` (category, palette guesses, fact categories expected). The runner
(`npm run eval:scan`) produces `ANSWERS/<site>/RESULT.md` with the actual
output and pass/fail vs the PRD success metrics. Add a case whenever a real
site surprises us — same discipline as propadm.in's 50-case corpus.

## Session handoff

Long builds track progress in `state.json` (exists) + a `HANDOFF.md` at the
repo root of long-running branches: what's done, what's next, gotchas found.
Keep it under 60 lines; it's a pointer into the docs, not a diary.

## MCP servers for build agents

Build agents (us) may use: **Context7** (library docs — see AGENTS.md),
**Playwright** (drive the running app to verify UI), **GitHub** (PR ops on this
repo via the FHL-08 token). The *product* exposes REST only; a `/mcp` endpoint
for customer agents is a P2 consideration, never an assumption agents bake in.
