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

## Blockers

None yet.
