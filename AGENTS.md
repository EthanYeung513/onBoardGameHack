<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agent instructions

## Product and architecture

Read [PRD.md](PRD.md) before writing code — it is the source of truth for what we
are building (manager-facing Orthogonal: landing, auth, scan, connectors, company
brain, courses, editor, dashboard). Shared interfaces that parallel agents must
not break are in [docs/BUILD-CONTRACT.md](docs/BUILD-CONTRACT.md). The multi-agent
process (backlog format, decisions log, PR rules) is in
[docs/AGENT-BUILD.md](docs/AGENT-BUILD.md). Service accounts and keys:
[docs/PROVISIONING.md](docs/PROVISIONING.md).

## Local development

`npm install && npm run dev` is the required entry point: it boots the local
Convex backend (Docker), pushes functions, seeds the demo space and starts Next —
see `skills/run-local-stack`. It
must start everything implemented and print URLs and login instructions. Local
startup must work with **no provider keys** (offline stand-ins — see below).
Whenever a service or script is added, wire it into the default path in the same
change; never require a second command a human must discover.

Useful: `npm run check:env` (one real call per configured service, pass/fail
table), `npm run demo:reset`, `npm run test` / `lint` / `typecheck` / `test:e2e`,
`npm run crawl:sample -- <url>`.

Node lives at `~/.nvm/versions/node/v24.19.0/bin` on Devin machines — export it
onto `PATH` before npm commands.

## Offline contract

Every external provider (LLM, crawl browser, embeddings, connectors, email) has
an offline stand-in used when its key is unset. Stand-ins are clearly labelled
in the UI and in responses. **Never silently simulate a provider success**: an
unconfigured provider returns `503` or its documented stand-in, not fabricated
live data.

## Model boundaries

- The model never writes UI. It returns JSON conforming to a Zod-validated spec
  (FlowSpec, CourseSpec, findings, extraction batches); the app owns rendering.
- System prompts are fixed strings in code (`src/lib/prompts.ts`,
  `src/tasks/registry.ts`) with snapshot tests. Everything that varies —
  project, pack, chunk, rubric — goes in the user message.
- Every generated or extracted item carries provenance: facts cite
  `source_chunk_ids`, findings cite crawled URLs, cards cite doc chunks.
- Validation failures go back to the model for a bounded number of retries
  (existing stage rules), never into the UI.

## Design

The mockup pages on `main` (`index.html`, `login.html`, `space.html`,
`editor.html`, `dashboard.html`, `brain.html`, `styles.css`, `state.js`) are the
visual spec. Match their layouts, copy tone and component shapes. Product
surfaces resolve colours through brand tokens extracted per space
(`brand_profiles`) — never hard-code a company colour. Nicole's taste rules: no
dark-mode-only surfaces, no walls of text, visual answers over prose.

## Tests and pull requests

- Keep the suite minimal with good coverage of meaningful behaviour, critical
  paths, edge cases and regressions. Prefer focused tests over tests that
  mirror implementation details.
- Run lint, typecheck and the relevant tests locally before pushing; include
  the commands and results in the PR description.
- UI changes need a screenshot or recording in the PR description.
- One PR = one concern. Small, numbered, mergeable independently.

## File size

Files must not exceed 1,000 lines. Split larger files into cohesive modules
before they reach the limit; the same limit applies to test files.

## Git conventions

- Branches: `feat/<slug>`, `fix/<slug>`, `docs/<slug>` off
  `feature/onboarding-generator`.
- Commits on this repo are authored by the team's shared GitHub account
  `Faisal Lawan <faisallawan08@gmail.com>` (FHL-08), not by personal identities.
  In Devin sessions, `git` is a wrapper that forces another identity — use
  `original_git` with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars set, and push via
  the `FHL08_GITHUB_PAT` secret (`https://x-access-token:$FHL08_GITHUB_PAT@github.com/...`).
  If a commit lands under the wrong identity, amend `--reset-author` before pushing.

## Secrets

Never commit credentials. Every new env var goes into `.env.example` with a
comment and a `check:env` entry. Customer credentials (connector tokens,
internal-app logins) are stored write-only in the `connector_credentials`
table and filled at runtime; they never appear in logs, prompts or responses.

## Current documentation

Use Context7 MCP to fetch current documentation whenever working on a library,
framework, SDK, API, CLI tool, or cloud service. This includes API syntax,
configuration, version migration, library-specific debugging, setup instructions,
and CLI usage. Prefer Context7 over web search for library documentation.

Do not use it for refactoring, writing scripts from scratch, debugging business
logic, code review, or general programming concepts unless library-specific
documentation is needed.

1. Start with `resolve-library-id` using the library name and the full question,
   unless an exact `/org/project` library ID has already been provided.
2. Select the best match by exact name, relevance, snippet count, source
   reputation, and benchmark score. Try alternate names or queries if needed;
   use version-specific IDs when a version is specified.
3. Call `query-docs` with the selected ID and the full question, scoped to one
   concept. Query separate concepts separately unless their interaction is the
   subject of the question.
4. Base the implementation or answer on the fetched documentation.
