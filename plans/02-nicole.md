> Plan 2 (Nicole). Copied verbatim from `onboarding-plan-en.md`; review notes added at the end.

# Gamify everything: hackathon plan (Night Shift, Mubit)

Status: draft, updated 2026-10-23 17:00. The product is a general gamification platform; onboarding is the first use case. Build starts once Nicole confirms the decisions in section 0.

## 0. Decisions needed before we start

1. **What "capability" means.** Both are buildable, but they are different products:
   - (a) Role judgment in context: in this company's real situations, does the new hire do the right thing (e.g. is a refund complaint handled in line with company policy).
   - (b) General ability: cognitive ability, personality, communication style, traits independent of the company.
   I recommend (a); reasons in section 2. This defines the product, so it is your call.
2. **What the assessment is used for.** Only to adapt the new hire's learning path (formative), or also for managers' people decisions. The latter is a high-risk use under Annex III (employment) of the EU AI Act.
3. **Demo company.** A fictional high-volume frontline employer (retail, hospitality or contact centre), e.g. a London coffee chain. No Algo1 or other real-company internal material.
4. **Second use case (generated live on stage to prove the platform is general).** Candidates: compliance training at the same company (allergens, anti-money-laundering), or customer product education.
5. **Grader shape.** One general grader (a single Mubit task; stronger platform story, harder for the adapter to pass) or one grader per domain (safer). I recommend general; confirm feasibility with Mubit at kickoff.

## 1. The product in one sentence

A general gamification engine: give it any content and the behaviours you want, and it generates scenario levels, assesses how players perform, and keeps learning from expert corrections. The first use case is onboarding: new hires handle real work situations during their "first week" and learn the company's content as they go.

**Why the platform's value is the grader:** gamification's effects depend on context and users (Hamari, Koivisto & Sarsa 2014 literature review, T1); Gartner predicted in 2012 that 80% of gamified applications would miss their business objectives because of poor design (T3, a prediction). Anyone can generate levels. The hard part is learning what "good" looks like in each domain: a grader that learns from expert corrections.

## 2. Why this design (evidence tiers: T1 official or peer-reviewed, T2 institutional research with a disclosed method, T3 vendor or opinion)

- **The problem exists:** only 12% of employees strongly agree their organisation does a great job of onboarding, and 29% of new hires feel fully prepared (Gallup, T2).
- **Gamification works, with modest effects:** a meta-analysis found g = .49 on cognitive learning outcomes, stable in rigorous studies; effects on motivation (g = .36) and behaviour (g = .25) were less stable (Sailer & Homner 2020, T1). So we lead with "learn better", not "more engaged".
- **Why (a):** role judgment has ground truth in the company's own policies and managers' judgment, so it can be validated. General ability cannot be validated in 39 hours; the first judge who asks "how do you know the score is right?" ends the argument.
- **Regulatory constraint:** the EU AI Act lists AI used for performance evaluation, task allocation and promotion as high-risk. Application was due 2026-08-02; the Digital Omnibus political agreement would move it to 2027-12-02, not yet final (law-firm commentary, T3; check the adopted text). The manager-correction step is itself human oversight, but under the Commission's draft guidelines a human in the loop does not by itself change the high-risk classification.

## 3. Mapping to the judging criteria

| Criterion (25% each) | How we score |
|---|---|
| Use of Mubit | A manager overrides a score → similar answers are immediately graded to the new standard (fast path) → the next adapter version learns it (slow path); the demo shows v1 vs v2 |
| Usefulness | In high-volume hiring, every new hire is graded on every scenario: high volume, recurring |
| Technical execution | An agreement metric: each adapter version's agreement with managers' rulings, rising with corrections |
| Demo | Judges scan a QR code, play a level themselves, and see their own score and feedback |

All three tracks are covered: recurring task (grading), own your intelligence layer (adapter vs GPT on cost and latency), fast refresh (upload a new policy document and scenarios and rubrics update; generate a second domain's levels live on stage, matching the track's own wording, "new domains").

Demo strategy: pitch the platform, prove depth with onboarding, prove breadth with the second use case.

## 4. System architecture

Every LLM call goes through Mubit (OpenAI SDK, `base_url=https://api.mubit.ai/openai/v1`, called from the server). Each task's system prompt stays fixed; everything that varies goes in the user message, otherwise Mubit splits it into a new task.

**Mubit tasks**

Platform abstraction: each use case is a "content pack" (documents, roles, rubric, level config); the engine and tasks don't change.

1. **T-Grade, the grader (the star, the one we train; in the general shape, one task shared by all domains)**
   - Input: domain, scenario, rubric, player's answer, similar past corrections retrieved.
   - Output JSON: 0 to 3 per competency, a quote from the answer as evidence, one line of feedback, the knowledge gap.
   - Correction: a manager changes the score in the review queue and writes one line of reasoning.
2. **T-Scenario, the scenario generator**
   - Input: a company document excerpt and a role.
   - Output JSON: scenario, options or an open question, rubric, the policy text it maps to.
   - Correction: L&D edits the scenario. Secondary; training not guaranteed.
3. **T-NPC, character dialogue (optional):** replies from characters such as a manager or a customer, for game feel.

**How a correction becomes a model update (my proposal, pending Mubit's confirmation)**

- Fast path: the correction is stored; the next time a similar answer arrives, it is retrieved into the user message and the provider model grades to the new standard on the spot.
- Slow path: Mubit records these calls as kept examples, and the next adapter version learns the correction into its weights.
- If Mubit gives hackers an official correction endpoint, use that instead and keep the fast path.

**Stack**

- Next.js App Router, deployed on Vercel.
- Postgres (Neon, via Vercel Marketplace) for employees, scenarios, answers, scores, corrections.
- Retrieval: pgvector, with embeddings also going through Mubit's `/embeddings`.
- Screens: player app (mobile first, judges scan in), manager console (review queue and competency radar), learning timeline (corrections, kept examples, training, versions passing, agreement curve).

## 5. Game design (proposal)

- **Structure:** the first week, five days, five levels; each day is one work situation delivered as messages in a chat interface (customer complaint, colleague asking for help, safety incident, data request, promotion rules).
- **Play:** mostly open-ended answers (so the grader has something to grade), a few multiple-choice questions for facts.
- **Feedback:** after each level, the score, the policy text cited, and "what an expert would do".
- **Progress:** XP, unlocking the next day, a team leaderboard (can be switched off).
- **Visuals:** no art assets; polished chat and card UI, to save time.

## 6. Data preparation

- Fictional company handbook: about 15 pages of policy (refunds, allergens, rotas, data privacy, safety), written by us.
- Scenarios: generate about 25, hand-pick 10.
- Employee answers: about 300 synthetic answers from different "employee personas" (beginner, careless, over-promising, model answer), to build up kept examples for the grader.
- Manager corrections: you correct about 40 against the rubric. This is the demo's core material, and where your expert judgment enters the system.

## 7. Timeline (Friday 19:30 to Sunday 10:00; clocks go back one hour at 02:00 Sunday)

Key constraints: Mubit's daily training limit resets at 00:00 UTC (01:00 BST Saturday; on Sunday, 00:00 UTC is 01:00 BST); there is an enforced pause between trainings; training starts by default at 25 kept examples; Try models allows 3 adapter starts per UTC day.

| Time | Work | Checkpoint |
|---|---|---|
| Fri 18:00 kickoff | Ask Mubit the questions in section 8 | Correction entry point and how to call adapters confirmed |
| Fri 19:30 to 22:00 | Get Mubit calls working; write the grader prompt and rubric; set up the database | First grading call visible in Mubit Requests |
| Fri 22:00 to 24:00 | Write the company handbook; generate scenarios; clickable game prototype | **Continue only after you approve the prototype** (one level of the player app) |
| Fri 24:00 to Sat 01:00 | Send about 150 grading calls in bulk | Tasks page shows enough examples |
| Sat after 01:00 | Adapter v1 trains (new UTC day) | Trains while we sleep |
| Sat 09:00 to 13:00 | Five levels in the player app, manager review queue; you make the first 40 corrections | Corrections take effect on the fast path |
| Sat 13:00 to 18:00 | Learning timeline, agreement metric, cost and latency comparison; send more calls to trigger v2 | v1 result in: Passed or Below target |
| Sat 18:00 to 24:00 | Fast-refresh flow for a new policy upload; second use case's content pack and "one-click level generation"; mobile polish | v2 training; second use case produces a playable level in under 60 seconds |
| Sun after 01:00 | Trigger v3 if needed; two full rehearsals | Keep at least 2 Try models starts for the demo |
| Sun 07:00 to 10:00 | Record a backup video; fix bugs; submit | 10:00 code freeze |

## 8. Questions for Mubit at kickoff

1. In the hacker version, how do human corrections become training data? Is there a dedicated endpoint?
2. Can adapters be called through the API? Is the Try models start limit raised for hackers?
3. How long, in practice, from enough examples to a version passing its tests? What is the daily training limit for hackers?
4. Can task and adapter status be read through the API?
5. How long is the demo slot? Who are the judges?
6. Can the adapter for a general task (domain and rubric both in the user message) pass its tests, or do you recommend one task per domain?

## 9. Demo script (prepared for 3 minutes; adjust once the limit is confirmed)

1. 0:00 The problem: 12% of employees think their company onboards well, and frontline companies onboard dozens of people a month.
2. 0:20 Judges scan in and play level one: answering a customer's allergen complaint.
3. 1:00 Manager console: the grader gave an answer a 2; you change it to 0 under company policy and write one line of reasoning.
4. 1:30 The next similar answer is graded to the new standard immediately.
5. 2:00 Learning timeline: the correction goes into training; adapter v2 vs GPT on agreement, cost and latency.
6. 2:30 Fast refresh: upload a second domain's documents (e.g. compliance training); a playable level appears within 60 seconds and the same grader starts grading.
7. 2:50 One closing line: onboarding is just the first content pack.

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Mubit has no correction entry point | Use the fast path plus slow path from section 4 |
| No adapter passes before the demo | Show Below target progress and the agreement trend; the fast path demos as normal |
| Can't finish both the game and grading | Cut to three levels; drop NPC dialogue |
| Judges question score validity | Answer: agreement with managers' rulings, tracked per version |
| Judges ask about compliance | Answer: results only shape the learning path; managers review every score |
| Judges think the platform is too broad | Answer: depth is in onboarding (correction count, agreement curve); breadth comes from generating the second use case live on stage |
| The general grader's adapter doesn't pass | Demo only the fast path for the second use case, or switch to one task per domain |

---

## Review: how this plan feeds the final plan

**Strengths**
- The most concrete Mubit knowledge on the team: the base URL, a fixed system prompt per task (otherwise Mubit
  splits it into a new task), 25 kept examples before training starts, a daily training limit that resets at
  00:00 UTC, a pause between trainings, and 3 Try models starts per UTC day. The final timeline is built around
  these limits.
- A key insight: **the grader is the product**. Grading is the highest-volume recurring task (every hire × every
  scenario), it has ground truth (manager rulings) and it gives a clean metric (agreement per adapter version).
- A fast path / slow path design, so a correction shows an effect on stage immediately while the adapter catches up.
- Covers all three tracks, cites evidence by tier, and is the only plan that addresses the EU AI Act (Annex III).
- Plans data seriously: 300 synthetic persona answers and 40 real corrections.
- Notes that clocks go back at 02:00 on Sunday 25 October.

**Gaps**
- With no art and a chat UI, the demo looks like every other "LLM grader" entry. The game gives a memorable demo
  and makes the pitch distinct.
- Having judges scan a QR code and play during a 3-minute demo puts timing and venue wifi on the critical path.
- A frontline coffee-chain company doesn't fit the rest of the team's engineering/company gyms.

**Taken into the final plan:** the grader as the one trained task, the fast/slow path, the agreement metric, all of
section 0's recommendations (role judgment (a), formative use only, a fictional company, a general grader with a
per-domain fallback), the training-quota timeline, the kickoff questions, the synthetic persona data and
correction targets, the EU AI Act answer, the "second domain generated live" fast-refresh beat.

**Changed:** the demo company is a fictional fintech with several departments (support, engineering, ops), so one
world can show company, compliance and role packs for any role. This keeps Nicole's platform framing: onboarding is
one use, and any content pack plugs in. The QR code is offered for Q&A and not used in the timed demo. The game
layer comes back.
