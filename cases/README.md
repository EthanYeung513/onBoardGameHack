# Scan eval corpus

Real websites the scan pipeline is measured against — the same discipline as
propadm.in's `Property Management/` case corpus and `ANSWERS/` reality test.
Add a case whenever a real site surprises the pipeline.

## Layout

```
cases/<site-slug>/
├── input.md      # URL, notes on the site, anything tricky (WAF, JS-only, no sitemap)
└── expected.md   # what a good run produces: category, palette guesses, page-count floor,
                  #   fact categories the brain should seed
ANSWERS/<site-slug>/
└── RESULT.md     # written by the runner: actual output + pass/fail per expectation
```

## Running

```bash
npm run eval:scan            # every case → ANSWERS/<slug>/RESULT.md
npm run eval:scan -- lumen   # one case
```

The runner executes the same pipeline the app uses (never a shortcut path),
against the live providers when keys exist and the offline stand-ins when not —
the result header must say which mode ran. Metrics checked against the PRD
success criteria: sitemap discovery rate, primary color ΔE, category accuracy,
facts seeded.

## Rules

- Cases are real public sites only — no fabricated fixtures here (fixtures live
  in `tests/`).
- Never hand-edit `ANSWERS/`; re-run instead.
- A case that fails is a bug or a changed expectation — fix one, not both.
