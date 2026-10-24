---
name: generate-course-from-brain
description: Generate a CourseSpec from approved brain facts — validated JSON, fixed step kinds, every teaching step cites facts.
---

# Generate a course from the brain

The model proposes; the schema disposes. Output is a `CourseSpec`
(`src/lib/flow/`, contract in BUILD-CONTRACT § course contract).

## Rules

1. Fixed step kinds only: `welcome | fields | lesson | quiz | scenario |
   checklist | done`. Steps outside the set are validation errors.
2. Every `lesson|quiz|scenario` step must list `teaches_fact_ids` referencing
   `approved` facts — courses teach the brain, not the model's general
   knowledge.
3. Validation: Zod shape, then cross-field rules (≥1 welcome first, ≥1 done
   last, fact ids resolve, option counts sane). Failures go back to the model
   ≤2 retries with the error text, then surface as a stage error.
4. Run inside `generate_courses` pipeline stage — one course per slice, upsert
   key `(space_id, title)` so resume doesn't duplicate.
5. The four default courses mirror the mockup: Company 101 (HQ Hall/quiz),
   People & Culture (Community Hall/inbox), Tools & Stack (Workshop/road),
   Hard Conversations (Dojo/scenario). Types map to brain categories.
6. `courses.spec` is immutable once published — edits write a new `version`;
   publish flips `status` and stamps the version.
7. Tokens coupling: `brand_profiles.tokens_version` bumps mark the course
   `stale` (regenerate or accept, manager's choice in the UI).
8. Test: seeded brain → valid spec asserting fact citations; invalid model
   output retried then failed readably.
