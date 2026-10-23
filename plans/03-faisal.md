> Plan 3 (Faisal). Copied verbatim from `onboarding-game-spec.md`; review notes added at the end.

# Gym Leader — gamified onboarding from a company's own docs

Working title: **Gym Leader** (placeholder, bikeshed later)

## Pitch

Turn a company's scattered internal knowledge — docs, wikis, handbooks — into a
Pokemon-inspired 2D turn-based game that new hires play to onboard. The game is
generated from the company's own content, adapts to what each hire gets wrong,
and ends each "gym" with a boss fight that specifically attacks their weak
spots. Powered by **Mubit** as the learning/memory layer.

## The problem

At startups and scale-ups (50–300 people), onboarding is tribal knowledge.
It takes months for a new hire to become effective because the answers live
scattered across Notion, Slack, and senior people's heads. HR has no way to
know what a new hire actually learned.

## The product

Two surfaces, one backend.

### Admin side (HR / team lead)

- Company logs in to a dashboard. Knowledge sources are already connected
  (for the demo: pre-seeded — "we already ingested Acme's 12 docs").
- The platform auto-generates a game: gyms, trainers, questions, all derived
  from the company's content. Every generated question carries a source
  citation back to the doc it came from.
- Admin reviews and edits the generated game in a **drag-and-drop editor**
  (dnd-kit): edit question text, reorder gyms/questions, pick creatures and
  themes, preview the battle. No code, ever.
- Admin sees a **readiness report** per hire: gyms cleared, weak topics, time
  taken. Also sees aggregate signals — e.g., "3 of 5 hires failed question 14;
  the underlying doc is ambiguous." The game audits the docs.

### Learner side (new hire)

- Logs in with a company code + name. No real auth needed for the demo.
- Plays through a world of 3 gyms. Each gym covers a topic area of the
  company's knowledge.
- Battles are turn-based: the opponent's creature attacks → a question
  appears → answer correctly and your counter-attack lands (their HP drops);
  answer wrong and the attack hits *you* (your HP drops). Opponent HP → 0 =
  win. Your HP → 0 = retry.
- The game **adapts**: questions weight toward topics the learner has failed
  before. Clearing all trainers in a gym unlocks the **Gym Leader** — a boss
  fight whose question selection is deliberately dominated by that learner's
  failure history. You cannot pass the gym without fixing your weak spots.
- Clear all gyms → "Pokemon master" completion state.

## Mubit — the load-bearing layer

Mubit is not a proxy in the architecture diagram; it is the learning brain in
the hot path. Three loops:

### Loop 1 — Learner memory (adaptive engine)

```
Battle start   → mubit.getContext(learner)  → weak-topic lessons
               → question picker weights weak topics ~60%
Each answer    → mubit.recordOutcome(attempt)
Battle end     → mubit.reflect()            → new lessons written
Gym leader     → context = only failure history → boss attacks weak spots
```

### Loop 2 — Curriculum memory (per company)

Outcomes aggregated across a company's learners reveal which questions
everyone fails → surfaced to the admin as "your doc is ambiguous" flags.
The game doesn't just teach the docs; it audits them.

### Loop 3 — Generation calibration

Question-generation calls route through Mubit as a named task. Admin
edits/approvals in the review queue become outcome signals → Mubit
self-optimizes the generation prompts. Every human correction makes the
next generated game better. This is the "invaluable" claim: Mubit closes
the loop between human review and generation.

### Demo-visible proof

A **"Mubit memory" debug panel** in the learner UI shows lessons being
written live as the player answers. Judges watch the system learn in real
time. Do not cut this — it is the sponsor story.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| App | Next.js + TypeScript + Tailwind | Fast to build, deploys to Vercel |
| Battle UI | React DOM + CSS animations | Turn-based needs no game engine; looks polished faster |
| Sprites | PokeAPI — Gen V `black-white.animated` sprites | Real animated B&W pixel sprites, exactly our art style |
| DB | Prisma + Postgres (Neon) | Zero-ops, deploys with the app |
| Memory | Mubit SDK (`getContext`/`recordOutcome`/`reflect`) + local `Weakness` mirror | Mubit in the hot path; local mirror so the demo never dies if the API flakes |
| Editor | dnd-kit | Real drag-and-drop without building primitives |
| Deploy | Vercel | One push, live URL for judges |

## Data model

```ts
Company  { id, name, slug, themeColor }
Gym      { id, companyId, name, topic, creatureName, leaderName, order }
Question { id, gymId, prompt, choices[4], answerIdx, sourceRef, difficulty }
Learner  { id, companyId, name }
Attempt  { id, learnerId, questionId, battleId, correct }
Weakness { learnerId, topic, attempts, fails }  // local mirror of Mubit lessons
```

## Demo story (what the judges see)

1. Show Acme Corp (fake fintech) admin dashboard: "12 docs ingested, 48
   questions generated." Review queue, edit a question inline.
2. Switch to a new hire's phone/laptop: login with company code, pick a name.
3. Play a battle — deliberately get a question wrong on Payments.
4. Mubit debug panel visibly writes a lesson: "weak on payment-flow."
5. Enter the Gym Leader fight — the boss asks about payment flow. The
   adaptation is demonstrable, not claimed.
6. Flip back to the dashboard: Sarah's readiness report now shows the
   cleared gym and flagged weak topic.
7. Architecture slide: the three Mubit loops.

## Scope

**In for the hackathon:** pre-seeded company, full battle loop, adaptive
question weighting, gym leader boss fights, dnd-kit editor, readiness
dashboard, Mubit loops 1 + 2 wired live, Loop 3 wired (calls proxied) +
architecture slide.

**Demo-only shortcuts:** canned company + pre-generated question bank
(questions written offline at seed time), company-code login instead of
auth, upload pipeline shown as an already-completed screen.

**Explicitly out:** live Slack/Drive connectors, real auth/tenancy,
generated creature art, freeform canvas editor, native mobile app
(responsive web only), production use of Pokemon IP (PokeAPI sprites are
demo-only; commercial version needs original art and no Pokemon branding).

---

## Review: how this plan feeds the final plan

**Strengths**
- The most fully designed game loop: HP-based turn-based battles, trainers, then a Gym Leader whose questions are
  drawn from **the learner's own failure history**. It is easy to show on stage that the game adapts.
- "The game audits the docs": when many hires fail the same question, the source doc gets flagged. This is a strong
  manager-facing feature that costs almost nothing.
- A Mubit panel that shows learning live, in the UI. The final plan keeps this as the Learning Timeline.
- A local `Weakness` mirror, so the demo keeps working if the API flakes.
- Every generated question carries a source citation. Battles use React DOM + CSS, which looks polished quickly.
- A clear and realistic list of what's in scope, what's a demo shortcut, and what's out.

**Gaps**
- Multiple-choice questions give the grader nothing to grade, so there are no corrections for Mubit to learn from.
  The judging requires "a correction turning into a model update".
- `getContext / recordOutcome / reflect` is a memory SDK that we haven't confirmed exists for hackers. Model
  updates (adapters) are the criterion being judged, not memory.
- The dnd-kit editor is a large build that doesn't move any judging criterion.
- PokeAPI sprites are Pokémon IP. They're fine for a fan demo but need a flag to switch to original art.

**Taken into the final plan:** the HP battle loop, the adaptive Gym Leader boss, "the game audits the docs",
the live Mubit panel, the local weakness mirror, source citations on every card, the pre-seeded company with
code-based login, React DOM battles, Gen V sprites behind a reskin flag, the demo-shortcut list.

**Changed:** battles mix multiple choice (facts) with **free-text answers** (judgment), which the grader scores.
Generation calibration (Loop 3) becomes the second Mubit task. The editor is cut to inline edit/approve in the
review queue.
