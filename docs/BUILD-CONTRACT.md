# Shared service and API contracts

Read `PRD.md`, `AGENTS.md` and `docs/AGENT-BUILD.md`. This file names the seams
parallel agents build against. Do not change these contracts without updating
this file in the same PR; an unchanged contract is a promise other agents rely
on. Keep all source and doc files within 1,000 lines.

## The pipeline is the unit of long work

All work longer than a request runs as sliced jobs (D-19). **State lives in Convex**
(`convex/pipeline.ts`: `jobs` + `job_events`); **work runs in the Node worker**
(`src/worker/`, started by `npm run dev`, on Modal in production) because stages need
Chromium (dembrandt), long HTTP crawls and the Mubit SDK. The worker claims a queued job,
runs one slice (≤45 s budget), heartbeats every ~3 s, and reports `done | continue | error`.
Convex owns retry (≤3, backoff 2 s·2ⁿ), stall detection (watchdog cron, >60 s → `stalled`),
manager resume (`pipeline.resume`, continues from the saved cursor) and chaining
(`SCAN_CHAIN` in `convex/lib/stages.ts`: crawl → extract_design → analyse → seed_brain →
generate_courses → ready). The legacy `src/lib/pipeline` (Supabase) serves only the old studio.

```ts
// src/worker/types.ts — register in src/worker/registry.ts; existing stages don't change shape
type StageDefinition = { name: StageName; maxAttempts?: number; run(ctx: StageContext): Promise<SliceResult> };
type SliceResult = { done: true; summary?: string; next?: { stage; cursor? }[] }   // next: extra jobs
                 | { done: false; cursor: Record<string, unknown>; progress: number }; // resume here
// ctx: job, space, scan, connector, convex (worker functions; secret added for you),
//      llm.json({task, system, user, schema, offline?}), embed.embed(texts), event(), progress(), remainingMs(), lost()
```

- Worker-only Convex functions use `workerQuery`/`workerMutation` (`convex/lib/worker.ts`,
  `WORKER_SECRET`); managers can never call them. Manager functions use `requireRole`.
- A stage with no registered handler leaves its job `queued` (visible in the scan log) — never faked.
- LLM: `ctx.llm.json` = Mubit JSON mode + Zod + bounded validation retries; without a key it
  uses the caller's labelled `offline` stand-in or throws `ProviderOffline` (503, one attempt).
- Embeddings: 1536-d (`EMBEDDING_DIMS`), offline hashed stand-in of the same width.
- Stage writes are idempotent upserts keyed on natural keys (URL, item+version+idx, …) so a
  resumed slice repeats nothing.

## Ingest contract (every source)

Website pages, files, GitHub, Nango tools — all go through `src/worker/ingest.ts`
`ingestDocument(ctx, {connectorId?, kind, externalId, url?, title, text, meta?})` →
`convex/ingest.ts` (`upsertItem` → versioned `source_items` + `diff_events`; `addChunks` →
embedded `doc_chunks`, idempotent per version; `sweepRemoved` after a full sync). A
`changed`/`removed` item marks citing facts `stale` and courses `needsRefresh` in the same
transaction (`markItemStale`). The website itself is a `website` connector.

## Constructor contract (public, unchanged)

The constructor components (no public page since D-18) consume four endpoints with fixed JSON shapes
(`src/lib/orthogonal/types.ts`, validated by `schema.ts`). Any real backend
must return these exact types:

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/orthogonal/scans` | `{ url }` | `ScanResult` (log, skeleton, palette, typography, features, ideas, structure, optional `status`/`progress`) |
| `POST /api/orthogonal/projects` | `{ scanId, siteUrl, repo, description }` | `Project` (build log, steps, levels, assets, connectors) |
| `POST /api/orthogonal/projects/:id/push` | `{ siteUrl, repo, steps, connectors }` | `PushResult` |
| `POST /api/orthogonal/projects/:id/publish` | same | `PublishResult` |

`src/services/orthogonal/index.ts` routes to `demo.ts` or `live.ts`.
`mapping.ts` translates findings/tokens/FlowSpecs ↔ constructor types and
applies constructor edits back onto the spec. New fields extend the types;
existing fields never change meaning.

## Scan → brand contract

`extract_design` output → one `brand_profiles` row per scan:

```ts
brand_profiles {
  space_id, scan_id, tokens_version int,      // bumped on every manual edit
  palette:   { name, hex, role: 'primary'|'accent'|'surface'|'text' }[],
  typography:{ heading: FontSpec, body: FontSpec, notes: string },
  logo_refs: { kind: 'mark'|'wordmark'|'favicon', url, format }[],
  voice:     string,                          // tone of voice summary
  radius?:   string, quality?: 'full'|'partial'|'offline',
  candidates?: BrandCandidates                // every value seen + evidence (src/lib/brand/candidates.ts)
}
```

Consumers read `tokens_version`; editing a token marks dependent courses
`stale`. The dashboard/editor resolve all colours through these tokens.
A new profile per scan gets the space's next `tokens_version`, becomes
`spaces.brandProfileId` and flags existing courses `needsRefresh`.

`candidates` = `{ source, palette, radius, headline, body, companyName, logos,
description, picked, labelledBy }`; each candidate is `{ value, count,
evidence: string[], hints: {role, by: 'site'|'css'|'model'}[] }`. The final
tokens come from **one swappable function**, `pickBrandTokens(candidates)` in
`src/lib/brand/pick.ts` (heuristic today; the brand-learning service routes it
through the learned Mubit recommender — same input/output). The model pass
(task `scan_brand`) only labels candidates; it never introduces new values.

`analyse` → `scans.findings` (`StoredFindings`, `src/lib/schemas/scan-findings.ts`):
`{ companyName, category|null, confidence, productSummary{text,sourceUrls},
features[], audience[], people[], terms[], rituals[], mode, model, generatedAt,
label? }` — every item cites crawled URLs (validated). `seed_brain` reads the
candidate people/terms/rituals from here. Crawl pages are also ingested as
`page` items of the space's `website` connector (externalId = URL).

## Connector contract

`connectors` status machine: `pending → authing → syncing → ready | error |
stale`. `stale` = source cursor moved on while offline; re-sync fixes it.

Every connector, whatever its upstream API, writes only:

```ts
source_items { space_id, connector_id, kind, external_id, url, title,
               raw_ref, meta jsonb, fetched_at }
doc_chunks   { source_item_id, idx, text, embedding, tokens }
```

Kinds: `page | file | doc | message | issue | pr | asset | screenshot`.
`external_id` is the tool-native id (dedupe + incremental cursor).
Credentials live in `connector_credentials` referenced by `auth_ref` — a
write-only table only internal Convex functions touch; connector code
never logs or returns credential material. Sync runs as `sync_connector`
pipeline stages, resumable by `cursor`.

Implementation (D-29): `src/worker/stages/sync_connector.ts` drives a `Syncer` per type
(`src/worker/connectors/*`); external ids are prefixed by tool (`github:<repo>:doc:<path>`,
`slack:<channel>:<YYYY-MM-DD>`, `jira:<KEY>`, `notion:<id>`, `drive:<id>`, `files:<name>`).
A sync with any added/changed/removed item finishes with `next: [seed_brain, cascade]`.
Convex side (`convex/connectors.ts`, `convex/connectorAuth.ts`): `connectors.list` (safe view, no
`authRef`), `syncNow`, `disconnect`, `generateUploadUrl` + `addFiles`, `cancelAuth`;
`connectorAuth.connectGithub`, `nangoStatus`, `nangoSession`, `nangoConnected`; worker-only
`credential`, `knownItems`, `touchItems`, `setSyncState`, `fileUrl`, `fileDone`; cron
`connectors.scheduleSyncs` (every minute: ready connectors past their interval → `stale` +
`sync_connector`; website → daily re-scan). `ingest.sweepRemoved` takes an optional `prefix`.
Tools-tab controls: `src/components/manager/tools/registry.ts` (`TOOL_REGISTRY`, `TOOL_CARDS`).

## Brain contract

```ts
entities        { type: 'person'|'tool'|'term'|'ritual'|'policy'|'product'|
                        'org_unit'|'doc',
                  name, aliases[], fields, version }
edges           { source_id, target_id, relation: 'owns'|'uses'|'mentions'|
                        'related_to'|'depends_on', evidence, version }
facts           { entity_id?, category: 'Glossary'|'People'|'Tools'|'Rituals'|
                        'Docs & History'|'Policy'|'Product'|'Other',
                  text, confidence 0..1,
                  source_chunk_ids uuid[]  — required, ≥1,
                  status: 'draft'|'approved'|'rejected'|'stale',
                  created_by: 'agent'|'manager' }
entity_mentions { entity_id, chunk_id, span {start,end}, confidence }
```

Rules: a fact without a citation is rejected at validation. Resolution order:
hard keys → embedding top-k → LLM adjudication (decision logged to
`audit_events`). Writes require the current `version` (409 on stale).

Read side: `GET /api/brain/graph` returns `{nodes,edges}` shaped for cosmos.gl
(`{id,label,x,y,size,color,cluster}`); `GET /api/brain/graph.gexf` exports for
Gephi; `GET /api/brain/search` returns results with citations.

## Course contract

`CourseSpec` (in `src/lib/flow/` next to FlowSpec):

```ts
{ title, icon, building, game: 'quiz'|'inbox'|'road'|'scenario',
  steps: Step[] }
Step = { kind: 'welcome'|'fields'|'lesson'|'quiz'|'scenario'|'checklist'|'done',
         title, body?, options?, teaches_fact_ids: uuid[] }
```

Validation: Zod + cross-field rules; every `lesson|quiz|scenario` step must
cite ≥1 `approved` fact. Assistant edits are validated patches
(`{op:'set'|'add'|'remove', path, value}`) — same rules as generation.

## Drift and self-adaptation contract (F34–F36)

The space must update itself as the company changes — agents implementing
sync/re-scan code must honour this cascade instead of inventing another one:

- Every connector tick and site re-scan compares new `source_items` against
  the stored version and appends `diff_events {space_id, kind:
  'added'|'changed'|'removed', source_item_id, summary}`.
- `changed`/`removed` marks every `facts` row citing that item's chunks
  `stale` and queues re-extraction; `added` queues extraction directly.
  Re-extraction re-runs resolution; outcomes land in `audit_events`.
- A fact going `stale` flags every `CourseSpec` step listing it in
  `teaches_fact_ids` → course row gets `needs_refresh=true`. Courses
  regenerate only on manager confirm; published `/s/:slug` content rebuilds
  from the new spec after regeneration.
- The cascade is per-space and resumable like any other job — a crashed
  mid-cascade run resumes from the last `diff_events` row processed.

How it is wired (S8, D-25):

- **Source stages end with `syncDone(summary)`** (`src/worker/ingest.ts`) →
  `{ done: true, next: [{ stage: "cascade" }] }`. `pipeline.finish` queues
  `cascade` per **space** (no scan/connector on the job), deduped while one is
  queued/running; `next` adds jobs *alongside* the scan chain, never replaces it.
  `seed_brain` also ends with `next: [cascade]`.
- **`seed_brain`** extracts every `doc_chunks` row without `extractedAt`
  (`brainWorker.pendingChunks` → `ctx.llm.json` task `brain_extract` →
  resolution → `brainWorker.commitChunk`, one chunk per transaction, idempotent).
  Facts dedupe on (entity, `facts.dedupeKey`); a match that is `stale` is
  restored (`fact.refreshed`); a match with a `rejected` fact is suppressed.
- **`cascade`** walks unprocessed `diff_events` oldest first: `added`/`changed`
  → extracts the item's current chunks, then `brainWorker.settleDiff` restores
  stale facts whose cited passage is unchanged and audits the rest
  `fact.still_stale` (they surface for review); `removed` → nothing to extract.
  `processedAt` marks each finished event; the job cursor keeps `lastId` + totals.
  Website pages and connector items (GitHub, Slack, Jira, Notion, Drive, files)
  take the same path.
- **Step-level (F38):** `course_facts.stepId` (written by course generation)
  names the CourseSpec step teaching a fact. `markItemStale` adds those ids to
  `courses.staleStepIds` (and sets `needsRefresh`); regeneration clears them.
  Audit rows: `fact.stale` and `course.step_stale` carry `source {connectorType,
  kind, title}`, and `course.step_stale.payload.chain` reads
  `slack “#payments” → fact “…” → course “…” → step s3`.
- Brain review (`convex/facts.ts`: `list`, `approve`, `edit`, `reject`, `add`)
  takes the fact's `version` (409 when stale). Search: `search.search` action
  (BM25 + vector + 1-hop), `GET /api/brain/search?space=&q=` embeds the query.

## API conventions

- Data routes are Convex functions; member-only ones assert `space_members`
  via `requireRole` in-function (Convex has no RLS — rules live in code).
- Errors: `422` validation, `404` missing, `409` version conflict, `401/403`
  auth, `503` provider unconfigured (never fabricated success).
- Every write emits an `audit_events` row `{actor, kind, payload}`.
- LLM JSON is parsed through Zod before use; failure → retry → readable error.

## UI conventions

- Mockup parity: layouts and copy match `main`'s pages; tokens come from the
  space's `brand_profiles` — never a hard-coded company colour.
- Long operations show live `job_events` lines, not spinners alone.
- Offline stand-ins are labelled wherever data is simulated.

## Generate → deploy contract (D-33)

`api.deploy.deployOnboarding({spaceId})` (managers) queues a `deploy` job; the worker writes
`spaces.deployUrl` (absolute Vercel URL, or `/o/<slug>` for the labelled stand-in),
`deployMode`, `deployState`, `deployedAt`, `deployError`. The deployed world is
`templates/onboarding/*` + generated `onboarding.js` (`src/lib/onboarding/content.ts`
`buildOnboardingContent` → `OB.*` overrides). Anything that renders the share link/QR reads
`space.deployUrl`; never construct deploy URLs elsewhere.

