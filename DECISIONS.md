# Decisions log (overnight run)

Run branch: `auto/gymquest-mvp`. Source plan: [PLAN.md](PLAN.md). Progress: [state.json](state.json).

## Morning Summary

**Status:** complete. **16 done, 4 skipped (human), 0 blocked.** Branch `auto/gymquest-mvp`, committed locally, not
pushed.

- **Done:** T1–T15 and T18. The working app covers: join → walk the office → trainer battles → adaptive Gym Leader
  → badge; free-text grading with evidence and citations; the review queue (approve/override); the fast path;
  the eval harness and regression gate; the learning timeline; policy edits marking cards stale; pack upload opening
  the annex; passport, readiness, doc audit and xAPI export; `demo:reset`; a README.
- **Skipped (need people):** T16 bulk grading + training (needs the Mubit key/console), T17 held-out labels and
  corrections (Nicole), T19 Sapling verifier (needs Mubit to confirm hosting), T20 deck/rehearsals/video (Richard),
  T18.2.1 deploy (hard limit: no deploys).
- **Verification:** 76 tests (21 files), `tsc`, ESLint (0 warnings) and `next build` all pass. `npm run smoke`
  drives the **production build** in Edge and passes: join, walk to the Support Gym, battle, see the grade in the
  review queue, upload the Warehouse Ops pack, annex opens. Screenshots were checked for the world, grade display,
  review queue, timeline and readiness.

**Commits (oldest first):** `41ccf0d` plans · `ae789f1` T1 · `7431b2f` T2 · `a5aca0a` T3 · `a16d5de` T4 ·
`543087c` T5 · `753c56a` T6 · `95d02fc` T7 · `9768a6b` test timeout fix · `99e3ba7` T11 · `2ea004e` T8 ·
`70df555` T9 · `029e2d0` T10 · `7235479` T12 · `dd037c5` T13 · `0980f19` T14 · `d796f0e` T15 · `4d5db05` T18 ·
`a7b9a82` PGlite hardening · plus this summary.

**Decisions to revisit:** D-2 (human tasks list), D-5 (set `DATABASE_URL` to Neon for deploy), D-7 (set the Mubit
env vars), D-8 (swap in Tiled + Kenney art), D-9 (confirm task tagging and `MUBIT_MODEL`), D-10 (real held-out
labels, and never quote numbers from the example set), D-12 (which upload flow to demo), D-14 (stray node processes
on Windows; delete `.data/pglite-corrupt-*`).

**What's needed to unblock the skipped work:**
1. **Mubit (T16):** key, base URL, model name, and the answer to "how do corrections become training data?"
   (PLAN.md §15). Put them in `.env.local`. If there's a feedback endpoint, set `MUBIT_FEEDBACK_URL` and check the
   payload in `src/services/feedback.ts` (it's a guess). Then, with `npm run dev` stopped:
   `npm run personas -- --per 5` and `npm run bulk-grade -- --limit 150`.
2. **Nicole (T17):** 40 labels in `eval/heldout.json` (format in README), then
   `npm run eval -- --label v0 --record`. Make the 60+ corrections in the review queue.
3. **Deploy:** Vercel + Neon, with `DATABASE_URL`, the Mubit env vars and `DEMO_RESET_KEY`.
4. **Sapling (T19):** only if Mubit hosts it.

**Review these first (risky):**
- **No auth** on `/admin` or the write APIs. `/api/packs` triggers LLM calls and `/api/docs` edits policies. Fine
  for a private demo URL; don't post the URL publicly.
- **Offline mode is a stand-in.** The offline grader is a rule-based baseline and the example held-out labels are
  placeholders I wrote. No number from offline mode belongs on a slide.
- `persona` is a third Mubit task (synthetic data). Expect it to appear separately in the Mubit console.
- Next 16 writes `AGENTS.md` on every `next dev`; it's committed so the tree stays clean.

## Planning decisions

### D-1: Task split follows the PLAN.md backlog
- **Task:** planning
- **Time:** 2026-10-23T21:40Z
- **Context:** how to break the plan into tasks
- **Options:** A) re-derive tasks from scratch / B) use PLAN.md §11 (T1–T20) and split each into steps and substeps
- **Chosen:** B
- **Why:** the team already approved that backlog; keeping the IDs means humans and the agent talk about the same tasks
- **Reversibility:** easy
- **Revisit?:** no

### D-2: Human tasks start as `skipped`
- **Task:** planning (T16, T17, T19, T20, T18.2.1)
- **Time:** 2026-10-23T21:40Z
- **Context:** some tasks need a Mubit key, expert labelling, Mubit confirming Sapling hosting, a deploy or the pitch
- **Options:** A) pending (then blocked after 3 attempts) / B) skipped with a reason
- **Chosen:** B
- **Why:** they can't be attempted unattended, and the hard limits forbid deploys
- **Reversibility:** easy
- **Revisit?:** yes. These are the morning to-do list for the team

### D-3: Order of work: correction loop before game layer
- **Task:** planning
- **Time:** 2026-10-23T21:40Z
- **Context:** PLAN.md says correction loop first
- **Options:** follow strict ID order / follow dependency order with the loop first
- **Chosen:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T11 → T8 → T9 → T10 → T12 → T13 → T14 → T15 → T18
- **Why:** the grade → correct → retrieve loop is what's judged; the eval harness (T11) only depends on T4, so it moves earlier
- **Reversibility:** easy
- **Revisit?:** no

### D-4: Project `.npmrc` points at public npm
- **Task:** T1.1.1
- **Time:** 2026-10-23T21:40Z
- **Context:** the user-level `.npmrc` points at the Collectiv Food CodeArtifact registry, whose token expires every 12h and which teammates can't use
- **Options:** A) use CodeArtifact / B) a project `.npmrc` with `registry=https://registry.npmjs.org/`
- **Chosen:** B
- **Why:** a personal hackathon repo shouldn't depend on work infrastructure; teammates can install without AWS access
- **Reversibility:** easy (delete the file)
- **Revisit?:** no

### D-5: Local DB is PGlite, never `localhost:5432`
- **Task:** T2.2
- **Time:** 2026-10-23T21:40Z
- **Context:** PLAN.md picks Neon Postgres. There's no local Postgres server, and `localhost:5432` is Ethan's SSH tunnel to work databases
- **Options:** A) Docker Postgres / B) PGlite (in-process Postgres, file-backed) locally + postgres-js when `DATABASE_URL` is set (Neon) / C) SQLite
- **Chosen:** B, plus a guard that refuses a `DATABASE_URL` on `localhost:5432`
- **Why:** real Postgres semantics with zero setup, the same Drizzle schema for Neon, and no chance of touching work databases
- **Reversibility:** easy
- **Revisit?:** yes. Set `DATABASE_URL` to the Neon URL when deploying

### D-6: Correction retrieval ranks in JS instead of pgvector
- **Task:** T5.1.1
- **Time:** 2026-10-23T21:40Z
- **Context:** PLAN.md names pgvector. pgvector columns need a fixed dimension, and the Mubit embedding model and its dimension aren't confirmed yet
- **Options:** A) pgvector with a guessed dimension / B) store embeddings as JSON arrays and rank by cosine in JS
- **Chosen:** B
- **Why:** hackathon volume is hundreds of corrections, so JS ranking costs nothing, works with any dimension and with the offline fallback embedding
- **Reversibility:** easy (swap the retrieval function for a pgvector query)
- **Revisit?:** no, unless corrections reach many thousands

### D-7: Offline LLM client so the app runs without a Mubit key
- **Task:** T3.1.2
- **Time:** 2026-10-23T21:40Z
- **Context:** no Mubit key is available overnight; the demo also needs a fallback if venue wifi fails
- **Options:** A) only mocked tests / B) an offline rule-based client used when `MUBIT_API_KEY` is unset, clearly labelled in the UI
- **Chosen:** B
- **Why:** the full loop (grade → correct → fast path) can be clicked through and tested end to end; Mubit becomes a one-env-var switch
- **Reversibility:** easy
- **Revisit?:** yes. Set `MUBIT_API_KEY` and `MUBIT_BASE_URL`, then check grades come from Mubit (header badge says "Mubit")

### D-8: Procedural placeholder tiles instead of Tiled + Kenney assets
- **Task:** T8.1.1
- **Time:** 2026-10-23T21:40Z
- **Context:** PLAN.md wants Tiled maps and Kenney CC0 tiles; downloading and wiring asset packs unattended is slow and the art is Richard's call
- **Options:** A) download Kenney packs / B) map as a typed character grid drawn with Phaser graphics
- **Chosen:** B
- **Why:** movement, doors and encounters can be built and tested now; the map data format is easy to replace with a Tiled export
- **Reversibility:** easy
- **Revisit?:** yes. Richard swaps in Tiled + Kenney art

### D-9: Task tagging header and default v0 model
- **Task:** T3.2.1
- **Time:** 2026-10-24T00:02Z
- **Context:** we don't yet know how Mubit identifies a task beyond the system prompt, or which model name it expects
- **Options:** A) wait for kickoff answers / B) fixed system prompt per task + an `X-Mubit-Task` header (configurable via `MUBIT_TASK_HEADER`) + `MUBIT_MODEL` env with a placeholder default
- **Chosen:** B
- **Why:** an extra header is harmless if Mubit ignores it, and the system prompt is fixed either way (PLAN.md §5). The model name is one env var
- **Reversibility:** easy
- **Revisit?:** yes. Confirm the task mechanism and set `MUBIT_MODEL` to the model Mubit expects (the `gpt-4.1-mini` default is a placeholder)

### D-10: Placeholder held-out labels, kept apart from the real set
- **Task:** T11.1.1
- **Time:** 2026-10-24T00:22Z
- **Context:** the eval needs labelled answers, but the real labels are Nicole's expert judgement (T17)
- **Options:** A) no data until morning / B) 12 placeholder labels I wrote, in `eval/heldout.example.json`, used only until `eval/heldout.json` exists, with a loud warning
- **Chosen:** B
- **Why:** the harness and gate can be tested end to end now; the eval refuses to look official (the warning and the `labeller` field say "placeholder")
- **Reversibility:** easy
- **Revisit?:** yes. Nicole writes 40 labels to `eval/heldout.json` (same format). Never quote numbers measured on the example set

### D-11: Evals measure the model alone, without retrieved rulings
- **Task:** T11.1.3
- **Time:** 2026-10-24T00:22Z
- **Context:** production grading adds retrieved corrections (the fast path); should held-out evals include them?
- **Options:** A) include retrieval (needs DB state) / B) measure the model alone
- **Chosen:** B
- **Why:** the claim to prove is that the *adapter* learned the standard. Retrieval would blur v0 vs v2, and evals stay reproducible without DB state
- **Reversibility:** easy (add a `--with-retrieval` flag)
- **Revisit?:** no

### D-12: Uploaded packs publish straight away by default
- **Task:** T13.1.3
- **Time:** 2026-10-24T00:45Z
- **Context:** PLAN.md wants "a new pack becomes a playable gym in under 60s" on stage, but also "separate generation from validation"
- **Options:** A) always drafts + manual approval / B) publish by default with a "Review cards before the gym opens" checkbox
- **Chosen:** B. With the box ticked, cards are drafts, the gym stays locked, and it opens when the last draft is approved
- **Why:** the live demo needs the door to open in one step; the review path exists and is one click away for the Q&A answer
- **Reversibility:** easy (flip the default in `ContentPanel` / the API)
- **Revisit?:** yes. Decide which flow the demo shows. Stale-card regeneration always produces drafts

### D-13: Policy edits re-point unchanged cards instead of regenerating everything
- **Task:** T13.1.1
- **Time:** 2026-10-24T00:45Z
- **Context:** when a doc changes, which cards are stale?
- **Options:** A) every card citing the doc / B) only cards whose section text changed (matched by heading)
- **Chosen:** B
- **Why:** an edit to one rule shouldn't invalidate the whole gym; the demo shows "1 card went stale, 5 carried over"
- **Reversibility:** easy
- **Revisit?:** no. Renaming a heading counts as removing the section (its cards are retired, not regenerated)

### D-14: PGlite gets a PID lockfile and clean shutdown in every script
- **Task:** Phase 3 (verification)
- **Time:** 2026-10-24T01:05Z
- **Context:** during verification the local `.data/pglite` was corrupted. Stopping a background shell on Windows left `next dev`/`next start` running, and `db:seed` then opened the same directory from a second process (PGlite has no locking). Scripts also exited without closing PGlite
- **Options:** A) document it only / B) `closeDb()` before every script exits + a `.data/pglite.lock` PID lockfile that refuses a second live process
- **Chosen:** B. The corrupt directory was moved aside (`.data/pglite-corrupt-*`, not deleted) and the DB reseeded
- **Why:** this would happen on stage during a rushed rehearsal; now it's a clear error ("open in another process (PID n)… use npm run demo:reset")
- **Reversibility:** easy
- **Revisit?:** yes. `.data/pglite-corrupt-*` folders can be deleted. On Windows, check Task Manager for stray `node` processes if a port is busy

### D-15: Hosted database is Supabase (team preference), deployed on Vercel
- **Task:** post-run (deploy prep)
- **Time:** 2026-10-24T10:45Z
- **Context:** Vercel can't run PGlite. The plan said Neon; the team prefers Supabase
- **Options:** Neon / Supabase (both plain Postgres to this app)
- **Chosen:** Supabase via its transaction pooler. The client reads `DATABASE_URL`, falls back to `POSTGRES_URL` (what Vercel's Supabase integration sets), strips provider-only URL params that postgres.js would forward to the server, adds `sslmode=require` for Supabase hosts, and disables prepared statements for the pooler. `drizzle/` and `content/` are added to the serverless file traces
- **Why:** team preference; no code depends on the provider
- **Reversibility:** easy (change the connection string and reseed)
- **Revisit?:** yes. Verified against a local Postgres-protocol server (seed, gameplay, grading, keyed reset, pack upload), not yet against a real Supabase project. Check the first deploy end to end

### D-16: `/` is the landing page; the constructor moves to `/try`; the Webflow export stays at `/classic`
- **Task:** S2 (landing page in-app, PRD F1)
- **Time:** 2026-10-24T23:55Z
- **Context:** PRD F1 puts a server-rendered marketing page at `/`, but `/` was the Orthogonal constructor and every page sat behind Supabase (503 with no keys)
- **Options:** A) landing at `/`, constructor at `/try` / B) landing at `/home`, keep the constructor at `/` / C) serve the static `index.html` at `/`
- **Chosen:** A. Landing in `src/app/(site)/` (no Webflow JS/GSAP; assets in `public/landing/`), constructor at `/try` linked as "Try the demo scan", original export copied to `public/classic/` (videos over 2 MB dropped) and served at `/classic` by a rewrite. `/`, `/try`, `/classic` and `/landing/` join the proxy's public list, checked before the Supabase-unconfigured 503 so they render with no keys. Sign-in with no `next` now lands on `/try`
- **Why:** visitors and the CTA (`/login?next=/space/new`) start at `/`; the constructor stays one click away for demos. The constructor's API calls still need a session, so signed-out visitors at `/try` see "Sign in required" on scan rather than a simulated result
- **Reversibility:** easy (move the page folder back, drop the rewrite)
- **Revisit?:** yes. Drop `/classic` once F1 ships; revisit the `/try` public entry when Convex Auth replaces Supabase

||||||| parent of 034c29a (feat: Convex foundation — schema, Convex Auth, spaces + roles (S3))
### D-17: Convex foundation — self-hosted local backend, one `npm run dev`, Supabase only for the legacy studio
- **Task:** S3 (auth + spaces + roles) / Phase 0 Convex skeleton
- **Time:** 2026-10-24T23:58Z
- **Context:** `npx convex dev --local` needs a newer glibc than our VMs have; the cloud dev deployment (`rapid-mosquito-655`) is shared. The scaffold's proxy gated every page behind Supabase (503 with no keys). Embedding width must be fixed for Convex vector indexes
- **Options:** A) cloud deployment for local dev / B) self-hosted Docker backend (`.convex-local`) booted by `npm run dev`, cloud kept for Vercel/Modal
- **Chosen:** B. `scripts/dev.mjs` starts Docker Convex, writes the admin key to `.env.local`, pushes functions, sets Convex Auth keys, copies provider keys into the function env, seeds the demo login, then runs `convex dev` + `next dev`. Manager routes (`/space`, `/dashboard`, `/brain`, `/editor`, `/course`) are gated by Convex Auth in `src/proxy.ts`; `/studio`, `/admin`, `/api/gen/*` keep the Supabase gate until migrated; the old Supabase `/login` is replaced. Vector indexes are 1536-d (`text-embedding-3-large` with `dimensions: 1536`; offline hashed stand-in matches)
- **Why:** works with zero keys on any machine with Docker; no shared-state collisions between agents; 1536-d halves storage with negligible recall loss
- **Reversibility:** easy (set `CONVEX_DEPLOYMENT` to go cloud; the index width is one constant, `EMBEDDING_DIMS`)
- **Revisit?:** yes — delete the Supabase gate and `src/lib/supabase` once the studio is migrated or retired

### D-18: The mockup is the spec — landing served verbatim, no demo surface (supersedes D-16)
- **Task:** S2 fix-up (Nicole review of PR #4)
- **Time:** 2026-10-25T00:45Z
- **Context:** PR #4 rebuilt the landing in React, invented "Build my onboarding"/"Try the demo scan" CTAs, dropped the mobile burger and animations, and moved the constructor to a public `/try`; the login page lost its animated hero. Nicole: the mockup pages on `main` are the exact visual and behavioural spec; the backend belongs behind login → create space → scan, not a demo button
- **Options:** A) keep fixing the React rebuild until it matches / B) serve `main`'s `index.html` + `assets/` verbatim at `/` (only `login.html` → `/login` rewired) and port the app pages (login, space, dashboard…) markup-for-markup with their own CSS
- **Chosen:** B. `/` rewrites to `public/index.html`; `/classic`, `/try` and the React landing are removed; `/login` is login.html ported (hero video, tiles, Auth0-style overlay steps) on Convex Auth with its own stylesheet; `/space/new` uses space.html's video hero. Providers without keys (Google, Apple, work SSO) open the mockup overlay with an honest "not set up" message instead of a simulated picker. The email step asks `authInfo.hasAccount` (the mockup's email-first flow; accepted account-enumeration trade-off for v1)
- **Why:** pixel and behaviour parity by construction; PRD's mockup→real table allows keeping the landing static
- **Reversibility:** easy
- **Revisit?:** when the landing needs dynamic content, or before public launch (enumeration, the export's inline-jQuery console errors that the mockup also has)

### D-19: Pipeline state in Convex, stage work in a Node worker
- **Task:** Wave 2 seam (S4/S6/S7/S8 prerequisite)
- **Time:** 2026-10-25T01:10Z
- **Context:** the scaffold's sliced runner is Supabase-bound. Stages need Chromium (dembrandt), long crawls, and Mubit calls; Convex actions can't run Chromium and have time limits. F7 wants live progress, F34 wants scheduled re-syncs
- **Options:** A) Convex actions for everything / B) Convex owns job state, retries, stalls, chaining, crons; a Node worker (local via `npm run dev`, Modal in prod) claims jobs with a shared `WORKER_SECRET` and runs slices
- **Chosen:** B. Worker wakes on a live subscription to the queue; every source writes through one ingest path that versions items, emits `diff_events` and runs the stale cascade transactionally
- **Why:** reuses `src/lib/crawl`/`design` unchanged, one runtime for all heavy work, live job_events for free, F35/F36 marking can't be skipped by a connector
- **Reversibility:** moderate (stages are plain functions; moving light ones into Convex actions is local)
- **Revisit?:** if Modal cold starts hurt demos — keep one warm worker

### D-30: One Mubit adapter for every LLM + embedding call
- **Task:** Mubit integrity (product owner, judge-visible)
- **Time:** 2026-10-25T01:00Z
- **Context:** the legacy studio client sent `MUBIT_API_KEY` to `MUBIT_ENDPOINT/anthropic` with a `claude-*` default, but the gateway serves only gpt-* + text-embedding-3-* (verified live). The new worker built its own OpenAI client
- **Options:** A) patch each caller / B) make `src/llm/mubit.ts` the only gateway client (`json` with Zod retries + task header + request id, `text`, `embed(dimensions)`), and wrap it everywhere
- **Chosen:** B. Worker providers wrap `MubitClient`; the legacy client's `gateway` route now calls `MubitClient` (Anthropic-shaped params converted, images as data URLs) and its streaming chat uses `@ai-sdk/openai` against the gateway; direct Anthropic remains only as the explicit paid fallback when `ANTHROPIC_API_KEY` is set. Defaults: `gpt-5.4-mini`, `text-embedding-3-large`. JSON mode appends a fixed "Respond with a single JSON object only." when a system prompt doesn't mention JSON (gateway requirement). `tests/mubit-integrity.test.ts` fails the build if any other file talks to the gateway or sends a Mubit key to an Anthropic path
- **Why:** judges inspect the adapters; Mubit learns per task only if every call is tagged and routed through it
- **Reversibility:** easy
- **Revisit?:** retire `src/lib/llm/client.ts` with the legacy studio


### D-22: Scan screen is step 3 of `/space/new`; mockup lines lit by pipeline stages in mockup order
- **Task:** S5 (live scan screen, F7)
- **Time:** 2026-10-25T01:10Z
- **Context:** space.html shows the scan as a third step of the same page (no navigation) and re-scans via `space.html?rescan=1`. Its six SCAN_STEPS lines don't map 1:1 to the stage chain (crawl → extract_design → analyse → seed_brain → generate_courses → ready); "Reading public pages" is listed after brand extraction
- **Options:** A) separate `/space/[id]/scan` route / B) step 3 of `/space/new`, URL carries `?space=&scan=` (refresh-safe), `?rescan=1&space=` starts a new scan straight away
- **Chosen:** B. Lines: "Resolving {host}" + "Found {n} pages via sitemap.xml" = crawl (n from `scans.pageCount` or a crawl event's `data.pages`); brand = extract_design; "Reading public pages" = analyse (the stage that reads the crawled pages, keeping the mockup's top-to-bottom order); knowledge graph = seed_brain; "Calibrating" = generate_courses + ready. The latest job_events line sits under the active step; failed → Retry, stalled → Resume (`pipeline.resume`); a stage queued > 20 s with no worker shows an honest "waiting" line. Success → `/editor?space=` after 900 ms like the mockup
- **Why:** matches the mockup's single-page transition and line order exactly; every lit line is a real job state
- **Reversibility:** easy (mapping is one pure function, `src/components/manager/scanSteps.ts`)
- **Revisit?:** if the crawl stage reports its own sub-steps, map "Reading public pages" back to crawl progress

### D-31: Google sign-in live; Apple dropped; login note removed
- **Task:** auth steering (Nicole 2026-10-25)
- **Time:** 2026-10-25T02:10Z
- **Context:** Google OAuth keys are now in both Convex deployments. Nicole is not an Apple developer, and wants the "Only if your company's IT team has set up Orthogonal sign-in…" line gone — both overrides of the login.html mockup
- **Options:** keep the mockup's Apple button with a "not set up" message / remove it
- **Chosen:** remove "Continue with Apple" and its overlay and the note; both Google buttons run the Convex Auth Google flow (`signIn("google")`); the honest "not set up" overlay remains only for deployments without Google keys
- **Why:** product direction overrides the mockup for these two elements; no dead buttons
- **Reversibility:** easy
- **Revisit?:** no

## Blockers

None yet.
