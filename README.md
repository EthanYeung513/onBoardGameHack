# DayOne — Gamified Onboarding

Built for Night Shift × Mubit hackathon. Restarted from scratch — the previous GymQuest code was removed.

**Concept:** onboarding that teaches the tribe, not just the product. DayOne reads a company's website, tools and docs into a "company brain" (knowledge graph), generates a curriculum, and publishes a Stardew-style explorable world where new hires meet NPC coworkers and play company-specific minigames. Progress flows back to a hiring-manager dashboard with rewards.

## Run it

Static site — no build step:

```bash
python3 -m http.server 8787
# open http://localhost:8787
```

## Flow to test

1. `index.html` — landing page (vendored Uniplay design, rebranded)
2. **Log in** → `space.html` — Create a Space → manager name + company website → fake scan/brain build animation
3. `dashboard.html` — manager dashboard themed to the scraped brand (Courses, Tools, Team, Analytics, Rewards, Settings)
4. **Courses → Publish world** → play link
5. `play.html` — hire logs in with company email → WASD/arrows to move, **E** to talk to NPCs and enter buildings, 4 minigames (quiz, inbox triage, road run, scenario), coin shop
6. Progress written to localStorage feeds the dashboard analytics

## Structure

- `index.html` + `assets/` — landing (Uniplay Webflow markup/CSS/fonts/media, rebranded, news + newsletter removed)
- `space.html`, `dashboard.html`, `play.html` — app shell
- `state.js` — localStorage "backend": space, brand, brain, courses, hires, progress
- `game.js` — canvas world + minigames
- `styles.css` — app pages' stylesheet (landing uses `assets/uniplay.css`)

Mockup phase: all data is simulated in the browser; no real backend, OAuth, or scraping yet.
