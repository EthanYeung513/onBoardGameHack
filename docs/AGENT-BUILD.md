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
| S2 | Landing page in-app | S1 | `/` served by Next.js, `/classic` fallback, CTA → login | — | auto |
| S3 | Auth + spaces + RLS | S1 | Signup/login/Google; create-space row; member roles | — | auto |
| S4 | Scan → brand_profiles + draft brain | S3 | Real scan of a public site fills `crawl_pages`, `brand_profiles`, draft `facts` | — | auto |
| S5 | Scan UI live | S4 | `job_events` stream into the scan screen; retry/stall states | — | auto |
| S6 | File-upload connector | S3 | Dropped PDF/MD lands as `source_items` + `doc_chunks` | — | auto |
| S7 | GitHub connector | S6 | OAuth/PAT connect → repos/docs/members ingested | — | auto |
| S8 | Brain schema + extraction + resolution | S6 | `entities`/`facts`/`edges` with citations; dedupe logged | — | auto |
| S9 | Brain review UI | S8 | Approve/edit/reject facts; manual add | — | auto |
| S10 | Brain page (cosmos.gl) | S8 | Graph renders clusters; click → provenance panel; GEXF export | — | auto |
| S11 | CourseSpec + generate_courses | S8 | Valid specs citing approved facts | — | auto |
| S12 | Editor on real data | S11 | Steps/preview/assets/design; patches validate | — | auto |
| S13 | Dashboard real data | S3, S11 | All tabs read aggregate endpoints; zero fabricated data | — | auto |
| S14 | Invites + play handoff | S13 | Email → hire role → `/s/:slug` → game handoff payload | — | auto |
| S15 | Slack/Notion/Jira/Drive via Nango | S7 | P1 connectors ingest | — | human (OAuth setup) |
| S16 | Eval corpus `cases/` + runner | S4 | ≥10 sites, `ANSWERS/<site>/RESULT.md`, metrics vs PRD | — | auto |
| S17 | Railway/Modal production deploy | S3 | Public URL, env matrix filled | — | human (account) |
| S18 | Internal web app connector (Browserbase) | S7 | Vault creds → browsed pages ingest | — | human (creds) |

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
gotcha (like the PGlite lockfile or the git wrapper). Runtime agent skills for
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
