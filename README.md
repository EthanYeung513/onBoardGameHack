# Orthogonal

Game-based onboarding, generated from your company. A manager enters the company website and connects its tools. Orthogonal builds a company brain, writes courses, and publishes a Stardew Valley-style world where each course is a building and lessons are mini-games.

Built for the Night Shift × Mubit hackathon.

## What the demo shows

Demo company: Mubit.

1. **Set up.** The manager creates a space from `mubit.ai`. The scan extracts the brand and seeds the brain.
2. **Brand.** The Design tab recommends brand tokens; the manager approves or corrects each one.
3. **Company brain.** A knowledge graph of facts from the site, docs and tools.
4. **Always current.** A handbook update (v3.1 → v3.2) marks the course steps that taught the old facts as stale; the manager refreshes them.
5. **The hire's world.** Log in, pick a character, walk into a course building.
6. **Mini-games**, each generated from course content:
   - **Battle**: Pokémon-style. Answer correctly to land a hit; wrong answers cost a life.
   - **Word Match**: arcade matching of terms to meanings against the clock, with combos.
   - **Dilemma**: Ace Attorney-style conversations. Someone pressures you; pick the reply that follows policy.

## Where Mubit is used

Every LLM and embedding call goes through one adapter, `src/llm/mubit.ts`. It uses Mubit's OpenAI-compatible gateway (`https://api.mubit.ai/openai/v1`) with gpt-* models (default `gpt-5.4-mini`) and `text-embedding-3-large`. Each request is tagged with its task name, and the Mubit request id is kept for feedback.

| Task | What it does |
|---|---|
| `extract_design`, `analyse` | Brand tokens and a company model from the crawled site |
| `brain_extract`, `brain_resolve`, `embed` | Facts from every document chunk, entity resolution, embeddings for search |
| `brand.recommend` | Recommends brand tokens from similar companies' past decisions and Mubit memory |
| `generate_course`, `regenerate_course_steps` | Courses from the brain; regenerates only the stale steps |
| `generate-game` | Turns course sections into a validated spec for one of the three games |
| `grade` | Scores free-text answers against a rubric |

**Brand learning.** Each Design-tab choice is stored as a `brand_decisions` row and sent to Mubit as approve or correct feedback, keyed by the `brand.recommend` request id. It is also written to Mubit memory (`remember`, `recordOutcome`), which later recommendations recall, so the next company starts closer to right.

**Self-updating courses.** Connectors (website, files, GitHub, Slack, Jira, Notion, Drive) version every source item. When an item changes, the facts citing it go stale and the exact course steps teaching them are flagged. On the manager's confirm, those steps are regenerated through Mubit.

Without keys, each Mubit task falls back to a labelled offline stand-in.
