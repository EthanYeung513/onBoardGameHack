---
name: readme-and-media
description: Write or refresh the repo README and its media (banner.svg, architecture/demos) the propadm.in way — hand-authored SVG banner, deterministic HTML animations recorded to gif/mp4, badge row linked to code.
---

Use when updating `README.md` or anything under `docs/media/`. This is how
Fergus-MW/propadm.in does it; copy the recipe, not the assets.

## README skeleton (propadm pattern, in order)

1. Centered `<div align="center">` block:
   - `<img src="docs/media/banner.svg" width="100%">` — the SVG banner.
   - Badge row: shields.io badges **linked into the codebase**
     (`[![cosmos.gl](https://img.shields.io/badge/cosmos.gl-live%20graph-f0d653)](services/admin-panel/components/screens/graph.tsx)`).
     Badges link to a file/dir, never to marketing pages.
   - One bold one-line pitch + CTA links (`▶ Watch the demo · Run it locally · Product brief`).
2. Narrative opening, 1–2 short paragraphs: a concrete day-in-the-life scene of
   the problem ("The tenant at Flat 3B rang about the boiler on Monday…"),
   then what the product does. No feature list yet.
3. `## ▶ See it run` — `demo.gif` (linked to `demo.mp4`) + one-line caption
   saying what the recording actually shows.
4. `## What it actually does` — bullets of real capabilities.
5. `## Architecture` — `architecture.gif` + short prose.
6. Who it's for, run-locally commands, links to PRD/AGENTS/design docs.

## Media conventions

- Sources live in `docs/media/src/`, rendered output in `docs/media/`.
- `banner.svg` is **hand-authored** (no generator): ~1200×300, brand bg colour,
  a doodle of the product's motif (graph nodes + edges for us), wordmark,
  italic tagline ribbon, mono-caps keyword line. Keep it under ~30 lines.
- `architecture.gif/mp4` is a **deterministic self-contained HTML page**
  (`docs/media/src/architecture.html`): zero deps, fonts as local woff2,
  seeded RNG, a `window.render(t)` that draws frame `t` of a fixed loop, and
  `#capture` in the URL disables the auto-loop so a recorder gets a clean
  deterministic run. Animate *data flowing through the real system* (packets
  along the actual edges), not decoration.
- `demo.gif` is a screen recording of the real local stack — never a mock.
- Big originals (`.mov`) go through Git LFS; `.gif` ≤ ~10 MB for README
  rendering, `.mp4` alongside as the high-quality link.

## Procedure

1. Draft `banner.svg` matching the current brand tokens (mockup's palette).
2. Write `architecture.html` with `window.render(t)` over the real pipeline
   stages (crawl → extract → brain → courses) and record it (Playwright or
   manual screen record) → `architecture.gif` + `.mp4`.
3. Record a real run of the app → `demo.gif` + `demo.mp4`.
4. Update README top block + badges to point at the new files; every badge
   links to the path it names.
5. Commit sources AND outputs together (a stale gif is worse than none).
