---
name: ship-pr
description: Commit, push and open a PR on this repo with the team's shared identity and the repo's PR conventions.
---

# Ship a PR

## Identity and push

- Commits author as `Faisal Lawan <faisallawan08@gmail.com>` (shared FHL-08
  account). In Devin sessions `git` is a wrapper forcing another identity —
  use `original_git` with `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL`
  env vars per commit. Wrong-author commit? `original_git commit --amend
  --no-edit --reset-author` before pushing.
- Push: `https://x-access-token:$FHL08_GITHUB_PAT@github.com/EthanYeung513/onBoardGameHack.git`
  (secret `FHL08_GITHUB_PAT`, repo-scoped). PR creation via `gh` with
  `GH_TOKEN=$FHL08_GITHUB_PAT`.
- Branch: `feat/<slug>` / `fix/<slug>` / `docs/<slug>` off
  `feature/onboarding-generator`.

## Before pushing

```bash
npm run lint && npm run typecheck && npm test   # and npm run test:e2e if you touched flows
```

- Files ≤ 1,000 lines (AGENTS.md rule).
- PR body: what/why, which BUILD-CONTRACT sections are touched, test commands
  + results, screenshots/recording for UI changes.
- One PR = one concern. Don't stack unrelated cleanups.
- Docs that changed the truth (PRD status flips, new env vars, new contract
  fields) go in the same PR as the code.
