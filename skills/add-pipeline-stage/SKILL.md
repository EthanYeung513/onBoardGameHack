---
name: add-pipeline-stage
description: Add a new stage to the sliced job pipeline (registry, types, heartbeat, upsert-resume, UI log) without breaking in-flight jobs.
---

# Add a pipeline stage

Long work never runs inside a request. It runs as stages over `jobs` +
`job_events` (`src/lib/pipeline/`): short slices, heartbeat ~3 s, stall >60 s
marked resumable, retries ≤3 with backoff.

## Steps

1. Add the name to `StageName` in `types.ts` and to `STAGES` order. Position
   matters: a stage reads only rows declared by earlier stages.
2. Write `stages/<name>.ts` exporting `const <name>Stage: StageDefinition` —
   `{ name, label, run(ctx) }`. Keep `run` short; if the stage can exceed one
   slice, persist its position in `jobs.state` and continue next slice.
3. Register it in `registry.ts` imports + `ORDER`. Wait points are declared
   with `waitFor(name, label, description)` for human gates.
4. **Idempotent writes:** upsert on the natural key (see BUILD-CONTRACT §
   pipeline). Resuming a finished stage must repeat no work — test by killing
   mid-stage and resuming.
5. Emit `job_events` lines for anything the scan UI should narrate
   ("Found 23 pages via sitemap.xml") — they stream to the user verbatim.
6. Errors: throw readable messages ("sitemap fetch failed: 403"), not stack
   fragments. The stage wrapper turns them into retry/error UI.
7. Test: unit test the `run` function against fixtures; extend
   `e2e/pipeline.spec.ts` if the stage is on the scan path.

## Contract reminders

- Stages never call the model with variable system prompts — fixed prompts in
  `src/lib/prompts.ts`, variables in the user message.
- New stage output rows belong to tables in `PRD.md`'s data model; new tables
  go through a migration + the PRD sketch updated in the same PR.
