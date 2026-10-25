# Per-company onboarding world (deploy template)

`play.html`, `styles.css`, `state.js` and `game.js` from the mockup on `main` (the hire-facing
world), served as a static site. `npm`-free: the Generate → deploy step (`src/worker/stages/deploy.ts`)
adds one generated file, `onboarding.js`, which overrides `OB.*` (brand, courses, quiz, inbox
cards, scenario, NPCs, rewards) with the space's real content. Edit these files to change the
deployed experience; keep `onboarding.js` loaded after `state.js` and before `game.js`.
