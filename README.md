# GymQuest

Onboarding for any role, played as a Pokémon-style game. New hires walk the office, battle trainers and dodge phishing
in the long grass, answering real work situations in their own words. An AI grader scores each answer against company
policy, managers correct the grades, and every correction becomes a Mubit model update.

Built for Night Shift × Mubit (track: **Recurring tasks**). The plan is in [PLAN.md](PLAN.md); overnight build notes
are in [DECISIONS.md](DECISIONS.md).

## Quick start

```bash
npm install          # uses the public npm registry (see .npmrc)
npm run db:seed      # local Postgres (PGlite) in .data/, seeded with Acme Pay
npm run dev          # http://localhost:3000
```

- **Play:** <http://localhost:3000/play>. Company code `ACME`. Walk with the arrow keys/WASD (a d-pad appears on
  phones). Walk into a door to battle; the long grass has wild phishing emails; Your Desk opens the skills passport.
- **Manager console:** <http://localhost:3000/admin>. Review queue, learning timeline, readiness, content.

With no `MUBIT_API_KEY` everything runs **offline**: a rule-based baseline grader, template card writer and hashed
embeddings. The UI says so wherever it matters.

## Connecting Mubit

Copy `.env.example` to `.env.local` and set at least:

| Variable | What |
|---|---|
| `MUBIT_API_KEY` | Turns on Mubit. Every LLM call then goes through Mubit's OpenAI-compatible endpoint |
| `MUBIT_BASE_URL` | Default `https://api.mubit.ai/openai/v1` (confirm at kickoff) |
| `MUBIT_MODEL` | The frontier model used as v0 (placeholder default `gpt-4.1-mini`) |
| `MUBIT_EMBED_MODEL` | Optional embedding model; unset = offline hashed embeddings |
| `MUBIT_FEEDBACK_URL` | Optional correction endpoint; unset = fast path + distillation fallback |
| `MUBIT_TASK_HEADER` | Header that tags each call with its task (default `X-Mubit-Task`) |
| `MUBIT_PRICE_INPUT_PER_M`, `MUBIT_PRICE_OUTPUT_PER_M` | USD per million tokens, for the cost column |
| `DATABASE_URL` | Hosted Postgres for deploys (see below; `POSTGRES_URL` also works). Unset = PGlite. `localhost:5432` is refused on purpose |

Three Mubit tasks, each with a fixed, snapshot-tested system prompt in [src/tasks/registry.ts](src/tasks/registry.ts):
`grade` (the one we train), `generate` (cards from docs) and `persona` (synthetic answers, data only). Everything
that varies goes in the user message, so Mubit keeps each task's examples together.

## Deploying (Vercel + Supabase)

The local PGlite database can't run on Vercel (read-only, per-request filesystem), so a deploy needs a hosted
Postgres. We use Supabase; any Postgres works, since the app only needs a connection string.

1. **Create the database.** Add Supabase from the Vercel Marketplace (Project → Storage), or create a project at
   supabase.com. The Vercel integration sets `POSTGRES_URL` (the transaction pooler, port 6543), which the app reads
   when `DATABASE_URL` isn't set. If you set it by hand, use Supabase's **transaction pooler** string. The direct
   `db.<ref>.supabase.co` host is IPv6-only on the free plan, which Vercel functions can't reach.
2. **Seed it once from your machine:** `DATABASE_URL="<supabase connection string>" npm run db:seed`. This runs
   the migrations and loads Acme Pay. Provider extras in the string (`supa=…`, `pgbouncer=true`) are stripped
   automatically, and `sslmode=require` is added for Supabase hosts.
3. **Set env vars in Vercel:** `DEMO_RESET_KEY` (so `npm run demo:reset -- --url https://<app> --key <key>` works
   and strangers can't wipe the demo), plus the Mubit variables when you have them.
4. **Deploy:** import the GitHub repo at vercel.com/new (Next.js is detected), or run `npx vercel`.

There's no login: anyone with the URL can use `/admin`, edit policies and upload packs (which make LLM calls once
Mubit is on). Share the link only with the team and the judges.

## How a correction becomes a model update

1. A hire answers; `grade` scores it (0–3 per competency, an exact evidence quote, feedback, the gap).
2. A manager overrides the score in the review queue with a one-line reason.
3. **Fast path:** the correction is embedded; the next similar answer retrieves it into the grader's prompt and is
   graded to the new standard straight away.
4. **Slow path:** the correction goes to Mubit (`MUBIT_FEEDBACK_URL`), or is distilled into kept examples by the
   fast-path calls. Mubit trains the next adapter.
5. `npm run eval -- --label v1 --model <adapter> --record` measures it on the held-out set. The regression gate
   promotes it only if agreement with the managers is at least the current version's. The learning timeline shows
   every version.

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` / `lint` / `typecheck` | Vitest (in-memory PGlite, offline LLM) / ESLint / tsc |
| `npm run db:seed` | Wipe and re-seed the local DB directly (stop `dev` first) |
| `npm run demo:reset` | Reset to the seeded state through the running app (or directly if it isn't running) |
| `npm run personas -- --per 5` | Write ~300 synthetic persona answers to `eval/personas/answers.json` |
| `npm run bulk-grade -- --limit 150` | Grade those answers through Mubit (fills kept examples and the review queue) |
| `npm run eval -- --label vN [--model id] [--record]` | Held-out eval → `eval/results/vN.json`, plus the gate with `--record` |
| `npm run smoke -- --url http://localhost:3000` | Drive the real app in Edge: join, walk, battle, review queue, pack upload |

PGlite is single-process: run `db:seed`, `bulk-grade` and `eval --record` with the dev server stopped, or point
`DATABASE_URL` at Supabase.

## Held-out labels

`eval/heldout.example.json` holds 12 **placeholder** labels so the harness runs. Before quoting any number, the
manager writes real labels to `eval/heldout.json` (same format: `id`, `card` = start of the card prompt, `answer`,
`human` 0–3, `labeller`). Those answers must never go through the review queue.

## Code map

| Path | What |
|---|---|
| `content/acme-pay/` | Fictional handbook (markdown) and `world.ts`: packs, gyms, cards with citations |
| `content/samples/warehouse-ops.ts` | The pack uploaded live in the demo |
| `src/tasks/` | Task prompts, the grader, the card writer, offline stand-ins |
| `src/llm/` | Mubit client, offline client, embeddings |
| `src/services/` | Grading, corrections + fast path, feedback sinks, review, adaptive boss, refresh, reporting, xAPI |
| `src/eval/` | Held-out set, metrics, regression gate |
| `src/game/` | Map, grid movement, battle rules, Phaser scene, event bus |
| `src/components/` | Play screens (battle, gym, passport) and the manager console |

## IP note

The Pokémon style is a fan-project look for the hackathon demo. Creatures are emoji by default;
`NEXT_PUBLIC_SPRITE_SOURCE=pokeapi` switches to Gen V sprites for the demo only. Any public or commercial release
needs original art. All company content is fictional.
