---
name: extract-brand-tokens
description: Turn crawl evidence into a versioned brand_profiles row (palette, typography, logos, voice) and keep downstream consumers in sync via tokens_version.
---

# Extract brand tokens

`extract_design` produces the raw evidence (dembrandt on a Chromium host, or
the HTML/CSS fallback elsewhere); an LLM normalization pass turns evidence into
the `brand_profiles` contract row (BUILD-CONTRACT § scan→brand).

## Steps

1. Evidence first, model second: gather dembrandt output / CSS variables /
   stylesheet rules / screenshot, then ask the model to normalize into the
   schema. Never let the model invent a palette it wasn't shown.
2. Palette roles are fixed (`primary|accent|surface|text`); extra colors go in
   `palette` with role omitted, never new roles.
3. Write one row per scan with `tokens_version = 1`; manual Design-tab edits
   `UPDATE` the row and `tokens_version += 1` — consumers compare versions.
4. Bump-side effects: when `tokens_version` changes, set dependent `courses`
   to `stale` (their spec was generated against older tokens).
5. Logo refs point at stored assets (Convex file storage), not hotlinks — copy the
   bytes during crawl so they survive the source site changing.
6. Partial extraction is honest: if only the HTML/CSS fallback ran (no
   Chromium host), set `meta.extraction='fallback'`; the Settings brand preview
   shows a "partial" chip.
7. Test: fixture sites (see `cases/`) — assert palette contains the site's
   real primary within a ΔE threshold, and `tokens_version` bumps propagate
   the `stale` flag.
