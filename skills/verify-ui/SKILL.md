---
name: verify-ui
description: Prove a UI change works by driving the running app (Playwright e2e or browser), with screenshots/recordings as PR evidence.
---

# Verify UI changes

Shell checks (lint/typecheck/vitest) are never enough for UI work — drive the
app.

## Local

```bash
export PATH=~/.nvm/versions/node/v24.19.0/bin:$PATH
npm run dev          # :3000, seeded
npm run test:e2e     # playwright suites in e2e/
```

- `e2e/click-all.spec.ts` follows every link and clicks every control, failing
  on console errors — extend it when you add a page/control.
- `e2e/pipeline.spec.ts` runs the full pipeline; `e2e/screens.mjs` captures
  screenshots into `artifacts/`.
- For interactive verification use the running Chrome via CDP
  (`http://localhost:29229` on Devin machines) or the browser tools directly.

## Evidence rules

- Every UI PR: screenshot (before/after when it's a visual change) attached in
  the PR description. Flows: a short recording.
- The mockup pages (tag `archive/main-mockup`, the original `main`) are the visual spec — screenshot the mockup and
  your page side by side when re-implementing one.
- Check mobile width and both light/dark where the surface supports themes.
- If the journey needs auth, use the seeded demo account rather than inventing
  a new signup each run.
- A handoff to the testing agent is fine for long flows — give it the URL, the
  seeded credentials, the exact acceptance steps, and which screenshots prove
  them.
