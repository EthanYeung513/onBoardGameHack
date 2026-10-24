# Shared service and API contracts

Read `PRD.md`, `AGENTS.md` and `docs/AGENT-BUILD.md`. This file names the seams
parallel agents build against. Do not change these contracts without updating
this file in the same PR; an unchanged contract is a promise other agents rely
on. Keep all source and doc files within 1,000 lines.

## The pipeline is the unit of long work

All work longer than a request runs through `src/lib/pipeline`: a stage
registry (`registry.ts`), sliced execution (`jobs` + `job_events`), heartbeat
every ~3 s, stall detection >60 s, retry ≤3 with backoff, resume by upsert keys
(URL, version, variant) so no completed work repeats. New stages are registered
in `registry.ts` and appended to `ORDER`; existing stages do not change shape.

```ts
type StageDefinition = {
  name: StageName;          // 'crawl' | 'extract_design' | 'analyse' |
                            // 'seed_brain' | 'generate_courses' |
                            // 'sync_connector' | 'ready'
  label: string;            // shown in scan UI
  run(ctx: StageContext): Promise<StageOutput>;
}
```

Stage writes are upserts keyed on the natural key declared by the stage
(`crawl_pages.url`, `brand_profiles.tokens_version`, `facts.text+entity`,
`connectors.type`). A stage's output rows declare what it produced; the next
stage reads only those keys — no hidden coupling through other tables.

## Constructor contract (public, unchanged)

The constructor UI at `/` consumes four endpoints with fixed JSON shapes
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
  voice:     string                           // tone of voice summary
}
```

Consumers read `tokens_version`; editing a token marks dependent courses
`stale`. The dashboard/editor resolve all colours through these tokens.

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
Credentials live in Supabase Vault referenced by `auth_ref`; connector code
never logs or returns credential material. Sync runs as `sync_connector`
pipeline stages, resumable by `cursor`.

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

Read side: `GET /api/brain/graph` returns `{nodes,edges}` shaped for sigma.js
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

## API conventions

- Data routes under `/api/…`; member-only routes check `space_members` + RLS.
- Errors: `422` validation, `404` missing, `409` version conflict, `401/403`
  auth, `503` provider unconfigured (never fabricated success).
- Every write emits an `audit_events` row `{actor, kind, payload}`.
- LLM JSON is parsed through Zod before use; failure → retry → readable error.

## UI conventions

- Mockup parity: layouts and copy match `main`'s pages; tokens come from the
  space's `brand_profiles` — never a hard-coded company colour.
- Long operations show live `job_events` lines, not spinners alone.
- Offline stand-ins are labelled wherever data is simulated.
