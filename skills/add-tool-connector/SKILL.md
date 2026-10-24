---
name: add-tool-connector
description: Add a new tool connector (OAuth or credential flow) that ingests remote items into source_items/doc_chunks and shows in the Tools tab.
---

# Add a tool connector

A connector is `{type, status, auth_ref, cursor, last_synced_at, error}`.
Status machine: `pending → authing → syncing → ready | error | stale`
(BUILD-CONTRACT § connector contract).

## Steps

1. Registry entry: `src/lib/connectors/registry.ts` (create if absent) —
   `{type, name, icon, desc, authKind: 'oauth'|'pat'|'creds'|'none', scopes,
   itemKinds}`.
2. Auth path:
   - OAuth: `GET /api/connectors/:type/start` → provider URL;
     `GET /api/connectors/:type/callback` → store token ref in
     `connector_credentials` (`auth_ref`), never the token itself in
     tables/logs (that table is write-only — only internal functions read it).
   - PAT/demo: accept a token, verify it with one cheap API call, store in
     `connector_credentials` the same way.
   - Internal web app: credentials → write-only; a browser session fills
     them at runtime (P2, see `skills`-note in PRD F13).
3. Ingest function `sync(ctx, connector, cursor)` → emits `source_items`
   (`kind`, `external_id` = tool-native id, `url`, `title`, `raw_ref`, `meta`)
   then `doc_chunks`. Chunk text as markdown; cap item size (5 MB).
4. Runs as a `sync_connector` pipeline stage (see `add-pipeline-stage`):
   resumable by `cursor`, upserts keyed on `(connector_id, external_id)`.
   Rate-limit aware: respect provider `Retry-After`, cap per-space budget.
5. Tools tab card reads the connector row only — connect button, status pill,
   last-synced time, error message. No fabricated progress.
6. Disconnect: `DELETE` → revoke token at provider best-effort, delete
   `auth_ref`, keep ingested items (flag in UI they're frozen).
7. Test: fixture the provider responses; test cursor resume and the
   `external_id` dedupe path. e2e covers connect → facts appearing in brain.

## Standard connectors and their item kinds

GitHub `doc|issue|pr` · Slack `message` batches · Notion/Drive `doc|file` ·
Jira/Linear `issue` · webapp `page` · files `file`.
