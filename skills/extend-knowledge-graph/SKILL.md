---
name: extend-knowledge-graph
description: Add an entity type, edge relation, or extraction rule to the company brain with migrations, resolution and provenance intact.
---

# Extend the knowledge graph

Brain tables: `entities`, `edges`, `facts`, `entity_mentions`, `doc_chunks`,
`source_items` (shapes in BUILD-CONTRACT § brain contract).

## Adding an entity type or edge relation

1. Extend the enum/type union in `src/lib/brain/types.ts`, the Zod schemas and
   the migration in the same PR.
2. Update the extraction prompt's fixed system text (`src/lib/prompts.ts`) so
   the model knows the new type — snapshot tests will fail until you update
   them; that's intentional.
3. Give the type a cluster color + label for the brain page legend (one row in
   the partition config, no scattered color literals).
4. Resolution rules: declare the type's hard keys (person → email/GitHub login;
   tool → domain/name; term → exact string). Hard keys resolve without the LLM.
5. If the new relation is rule-generated (e.g. `uses` from co-occurrence), the
   rule is data (`edges.rule` + `rule_version`), not code paths that edit edges
   by hand — manual unlink can't remove rule-generated edges.

## Extraction and facts

- Facts require `source_chunk_ids ≥ 1` — citation-less facts fail validation.
- `confidence < threshold` (default 0.9) → `status='draft'` for review; the
  rejected list feeds back into the prompt as negative examples.
- Every write emits `audit_events`; resolution tie-breaks log the decision.

## Tests

Fixture chunks → assert extraction shape, dedupe merges, citation presence,
and that a doc version bump marks citing facts `stale`.
