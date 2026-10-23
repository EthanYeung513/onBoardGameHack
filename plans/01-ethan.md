# Plan 1 (Ethan): Onboarding Game x Mubit

As of 23 October 2026 · Ethan Yeung · cleaned up from the original paste, content unchanged

## Overview

A Pokémon game set in the company's office. New hires learn company, role and compliance knowledge through
Pokémon battles, gym badges, quests and wild encounters. Every correction from a manager or security reviewer
becomes a Mubit model update.

- **Problem:** onboarding is scattered docs, generic compliance videos, and bots that give stale or wrong answers
  once policies change.
- **IP:** uses Pokémon names, creatures and style as a fan project for the hackathon demo. Pokémon is owned by
  Nintendo, Game Freak and Creatures, so any public or commercial release needs a licence or an original reskin.

## Game structure

The game teaches three tiers of knowledge, each with its own in-game form.

| Tier | In-game | Content |
|---|---|---|
| Company | Department gyms, badges, internal systems as creatures | Internal docs and processes |
| Field | Role routes between gyms; creatures evolve with mastery | MCP, OAuth, CI/CD (eng); FEFO, cold chain (ops) |
| Compliance | Random encounters plus a Security HQ | Phishing inbox, tailgating, gifts/bribery, data protection, fire safety |

Real quests (tests passed, intro posted) are verified via the GitHub and Slack APIs. A placement battle skips what
a hire already knows.

## How Mubit is used

Every LLM call goes through Mubit with a single base URL change, and four recurring tasks each have their own
correction loop.

| Task | Does | Corrected by | Metric |
|---|---|---|---|
| `battle-gen` | Doc to scenario card with cited source | SME edits or rejects | Acceptance rate |
| `phish-gen` | Generates labelled phishing or legit emails by difficulty | Security reviewer | Reviewer acceptance |
| `answer-grade` | Scores free-text explanations | Mentor overrides | Agreement with mentor |
| `mentor-qa` | Answers hire questions from docs | SME fixes | Held-out accuracy |

- **Corrections become model updates.** Each approve, edit or reject is sent to Mubit as feedback, and Mubit builds
  a task-adapted model update. Show v0 to v1 on held-out data.
- **Objective verdicts only.** Signals come from SME and security review, API-verified quests, and known phishing
  labels, never the model grading itself.
- **Fast refresh.** When a source doc changes, every card citing it is marked stale and regenerated, so the model
  keeps pace with policy changes.
- **Evaluation and rollback.** Compare frontier vs adapted model on quality, cost and latency, and show that a
  regressing update gets blocked.
- **Sapling (if Mubit hosts it).** Verifies compliance answers against policy. If it returns insufficient
  information, the question routes to compliance instead of the mentor guessing.

## Tech stack

Phaser 4 + React in TypeScript: Phaser draws the game, React handles every text-heavy screen, and one Node service
serves both.

| Layer | Choice | Why |
|---|---|---|
| Game | Phaser 4.2.1 (TS), scaffolded with Phaser's create-game app (Vite + React template) | Default for code-first 2D web games; ships skill files for AI coding agents |
| Maps | Tiled to JSON, Kenney CC0 tilesets | Free and licence-safe |
| Movement | Hand-rolled grid step (about 50 lines) | Avoids plugins that may lag on v4 |
| UI overlay | React + Tailwind, Zustand | Dialogue, battle cards, phishing inbox, admin console |
| Backend | Node + Hono, Zod, SQLite (Drizzle) | Card and Correction types become Zod schemas |
| LLM | `openai` npm client pointed at the Mubit base URL | One-line Mubit integration |
| Integrations | Octokit (GitHub webhook); Slack faked for the demo | API-verified quests |
| Deploy | One Node service serving the Vite build (Railway, Fly or Render) | Single deploy for the demo |

Mubit client (confirm the base URL and feedback endpoint at office hours):

```ts
import OpenAI from "openai";

const baseURL = process.env.MUBIT_BASE_URL;
const apiKey = process.env.MUBIT_API_KEY;
const llm = new OpenAI({ baseURL: baseURL, apiKey: apiKey });
```

- **Why not Unity:** slow web builds and large bundles, text-heavy UI is faster in React, every API call crosses a
  C# to JS bridge, and the admin console must be a web app anyway.
- **Event bus:** Phaser emits events such as `encounter:phish`, and React opens the matching screen.
- **Phaser 4 risk:** v4 is new, so some community plugins may lag. Fall back to Phaser 3.90 if one you need breaks.
  Current stable is v4.2.1, released 9 July 2026.
- **Team split:** (1) Phaser map, movement, encounters; (2) React battles, inbox, dialogue; (3) backend, Mubit,
  correction loop; (4) admin console, synthetic handbook, demo.

## Industry standards

There is no single game-engine standard, but training records have one that buyers require: SCORM, xAPI and cmi5.

- **Game engines:** by volume Unity leads, with 55% of HTML5 games released in H1 2025, ahead of Construct (16.4%),
  Cocos (8.1%) and Phaser (7.1%) (Playgama via GameDev Reports). That counts studio games shipped to web portals,
  not games inside business apps, where Phaser is the code-first default.
- **SCORM:** the packaging standard that ships compliance courses into virtually any LMS. SCORM 1.2 still dominates
  pass/fail compliance training (Coggno).
- **xAPI:** records actor-verb-object statements ("Maria completed X with score 92") in a Learning Record Store,
  capturing activity beyond one course.
- **cmi5:** the xAPI profile that launches like a SCORM course but reports xAPI statements. Coggno notes it earns
  its keep for cybersecurity programmes running phishing simulations, which is this game's compliance tier.

**Product plan:** emit xAPI statements and support cmi5 or SCORM 1.2 launch, so completions land in the customer's
existing LMS.

**Hackathon plan:** don't build SCORM packaging. Shape audit-log events as xAPI statements and put "exports to your
LMS via xAPI/cmi5" on a slide.

```json
{
  "actor": { "mbox": "mailto:new.hire@acme.example" },
  "verb": { "id": "http://adlnet.gov/expapi/verbs/passed" },
  "object": { "id": "https://acme.example/onboarding/phishing/v3" },
  "result": { "score": { "scaled": 0.9 }, "completion": true }
}
```

Putting the policy version in `object.id` (`/v3`) gives the "which version did they attest to" audit trail for free.

## Demo (3 minutes)

The demo shows two corrections turning into model updates, then a live policy change.

1. A phishing email pops up mid-walk, the hire clicks it, and gets a debrief.
2. The security reviewer flags the generated email as too obvious; Mubit updates and the next one is harder.
3. The mentor gives a wrong expense answer, the manager corrects it, and the paraphrased question now comes back
   right.
4. The handbook is edited live, and stale cards are flagged and regenerated.
5. The manager dashboard shows completion, audit trail and doc gaps.

**Pitch hook:** Mubit is SOC 2 and ISO 27001 certified, both of which expect security awareness training, so the
judges are a potential customer.

## Scope for 38 hours

Build one module per tier and the correction loop first; everything else appears as locked doors on the map.

- **Build:** one Ops gym, one engineering route covering MCP, and the phishing inbox.
- **Build order:** correction loop and admin console first, game layer second.
- **Stack:** Phaser 4 + React + TypeScript, a Node backend, SQLite, all calls via Mubit, and a synthetic company
  handbook.

## Side quest: Model Card

The side quest is a separate individual entry, but its thesis matches the project: one company knowledge base that
onboards both people and coding agents.

- **Enter four times.** It is one entry per person, so every teammate submits their own logs.
- **Route Claude Code through Mubit while hacking.** Every request shows up in the Mubit console. Upload logs on
  Saturday night so the model card reflects building this project.
- **Demo slide:** "We onboarded our coding agent too", showing the patterns the team kept repeating to Claude Code
  this weekend.
- **Stretch idea (slide only):** approved cards compile to a CLAUDE.md or skill for the company's coding agents,
  and repeated corrections in agent logs become onboarding cards for humans.
- **Caution:** `~/.claude/projects/` holds a folder per project, including work repos. Mubit redacts keys and
  secrets, not proprietary code, so upload only hackathon or personal project folders.

## Appendix: overnight autonomous agent prompt

Ethan's prompt for running a coding agent unattended overnight against the final plan
(`The plan is: PLAN.md`). The backlog in [../PLAN.md](../PLAN.md) is written to fit this format: each task has an
ID, dependencies and an acceptance check.

<details>
<summary>Full prompt</summary>

```text
# AUTONOMOUS OVERNIGHT RUN

You are running unattended. The user is asleep and will not answer anything until morning.
Do not ask questions, do not wait for confirmation, and do not end your turn until every
task in state.json is `done`, `blocked`, or `skipped`.

## Input
The plan is: <PASTE PLAN HERE, or: "the plan above" / "PLAN.md">

## Files you own
- `state.json`: the single source of truth for progress. Update it after EVERY substep.
- `DECISIONS.md`: every decision you make, with reasoning, in the format below.

## Phase 1: Plan (before touching any code)
1. Read the plan and explore the codebase enough to understand it.
2. Break the plan into tasks, then steps, then substeps. Each substep should be small enough
   to finish and verify in one go (one function, one file change, one test run).
3. Give every task an acceptance criterion: a concrete check showing it is done (a test
   passes, a command succeeds, an endpoint returns X).
4. Record dependencies between tasks.
5. Write `state.json` using this schema, with every status set to `pending`:

{
  "goal": "one-line summary of the plan",
  "phase": "planning | executing | verifying | complete",
  "started_at": "ISO timestamp",
  "updated_at": "ISO timestamp",
  "branch": "git branch name",
  "current": { "task": "T1", "step": "T1.1", "substep": "T1.1.1" },
  "tasks": [
    {
      "id": "T1",
      "title": "",
      "status": "pending | in_progress | done | blocked | skipped",
      "depends_on": [],
      "acceptance": "",
      "commit": null,
      "steps": [
        {
          "id": "T1.1",
          "title": "",
          "status": "pending",
          "substeps": [
            {
              "id": "T1.1.1",
              "title": "",
              "status": "pending",
              "attempts": 0,
              "notes": "",
              "decision_refs": []
            }
          ]
        }
      ]
    }
  ]
}

6. Create `DECISIONS.md` and log your planning decisions: how you split the work, what order
   you chose, and any ambiguity in the plan and how you resolved it.
7. Create a branch with `git checkout -b auto/<short-goal-name>` and set `phase` to `executing`.

## Phase 2: Execute loop
Repeat the following until no task has status `pending` or `in_progress`:
1. Read `state.json`.
2. Pick the next `pending` substep whose task dependencies are all `done`.
3. Set that substep, its step, and its task to `in_progress`. Update `current`. Save.
4. Do the work.
5. Verify it: run the relevant tests, typecheck, lint, or build.
6. On success, mark the substep `done`, add short notes, and save.
7. When all substeps in a step are done, mark the step `done`.
8. When all steps in a task are done, run the task's acceptance check. If it passes, commit
   with the message `T<id>: <title>`, store the commit hash in `commit`, and mark the task `done`.

## Decisions
- When something is ambiguous, choose the option that is most reversible and most consistent
  with the existing codebase's conventions.
- Log every non-trivial choice in `DECISIONS.md` as follows:

### D-<n>: <short title>
- **Task:** T1.2.3
- **Time:** ISO timestamp
- **Context:** what needed deciding
- **Options:** A / B / C
- **Chosen:** B
- **Why:** reasoning
- **Reversibility:** easy / moderate / hard
- **Revisit?:** yes/no, and what the user should check

- Add the decision ID to the substep's `decision_refs`.

## Never stop: failure handling
- If a substep fails, increment `attempts`, try a *different* approach, and record what
  failed in `notes`.
- After 3 failed attempts, mark the substep `blocked` and log the reason in DECISIONS.md
  under a `## Blockers` section. Mark any tasks that depend on it as `blocked` too.
  Then continue with the next unblocked work.
- If something needs information you don't have (credentials, product intent), make a
  reasonable assumption, log it as a decision, and continue. If no safe assumption exists,
  mark it blocked and continue.
- Never end your turn while unblocked `pending` work remains.

## Hard limits (log these as blocked instead of doing them)
- No force pushes, no pushing to or merging into main/master, no deploys.
- No deleting data, dropping tables, running migrations against non-local databases, or
  touching production resources.
- No sending emails or messages, no purchases, no changes to cloud infrastructure.
- No editing secrets or `.env` files beyond reading them.
- Do not disable or delete tests to make them pass.

## Context management
- `state.json` and `DECISIONS.md` are your memory. If your context is compacted or you
  lose track, re-read both files before doing anything else, then resume from `current`.
- Keep `notes` short. Detail belongs in DECISIONS.md.

## Phase 3: Finish
1. Set `phase` to `verifying`. Run the full test suite, build, and lint. Fix any regressions,
   staying within the same failure rules.
2. Set `phase` to `complete`.
3. Add a `## Morning Summary` section at the TOP of DECISIONS.md containing:
   - Tasks done, blocked, and skipped (counts and IDs)
   - The branch name and the commit list
   - Decisions marked "Revisit?: yes"
   - Every blocker, with what you need from the user to unblock it
   - Anything risky you'd want reviewed first

Begin with Phase 1 now.
```

</details>

---

## Review: how this plan feeds the final plan

**Strengths**
- The strongest product shape: walkable office, three knowledge tiers, phishing as wild encounters.
- Thinks most about how judges will push back: verdicts only from humans or known labels, a regression gate,
  fast refresh through stale-card detection.
- Has the best commercial hook (SOC 2 / ISO 27001 need security awareness training, so Mubit is a customer) and the
  most credible enterprise detail (xAPI with the policy version in `object.id`).
- Has the clearest side-quest strategy.

**Gaps**
- Four trained tasks split ~40 corrections four ways. No single adapter would get enough examples to pass in a weekend.
- Doesn't address Mubit's training limits (examples needed before training, daily quota, pause between runs).
- GitHub/Slack-verified quests and placement battles take build time that doesn't help the judging criteria.

**Taken into the final plan:** the walkable world (Phaser for the map, React for text screens), phishing encounters
plus a Security HQ, objective verdicts only, stale-card fast refresh, the regression gate, the Sapling verifier,
xAPI events, the SOC 2 pitch hook, the side-quest plan, "correction loop first" build order, the overnight agent prompt.

**Cut or deferred:** `mentor-qa` and `phish-gen` as separately trained tasks (they become content types of one
generator), GitHub/Slack quests, the placement battle, creature evolution.
