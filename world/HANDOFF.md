# Stardew-Inspired Onboarding World — Handoff

## What this is

A React + Phaser rebuild of the onboarding "world" experience, styled on
Stardew Valley. Flow: **title screen → login → character select → explorable
town**. One building per course (from the manager dashboard curriculum),
NPCs that share company fun facts, hover tooltips with completion %, and a
Stardew-style course start menu when entering a building.

## Where it lives

- Repo: `EthanYeung513/onBoardGameHack`
- App directory: `world/` (Vite + React + TypeScript + Phaser 3)
- The older canvas mockup (`game.js`, `play.html`) still sits at repo root and
  is untouched — this app is a fresh build.

## Status: what works now

- **Title screen** — generated pixel-art mountain/star backdrop + wooden-style
  company-name logo (PIL-rendered with the Stardew font) + Play button.
- **Login** — mockup-style card (name + work email, Continue with Google /
  Apple SSO buttons — mock auth, any valid input proceeds).
- **Character select** — arrow-cycled character previews (6 variants) from the
  generated spritesheet, then "Start Day One".
- **Town scene (Phaser `TownScene`)** — 60×40-tile town: town hall plaza,
  course buildings in left/right columns connected by paths, pond, crop
  field, trees/fences/props. WASD/arrows movement with 4-direction walk
  animation, camera follow, collision.
- **Buildings = courses** — hover shows course name + completion bar;
  walking to a door shows an "Enter" hint; E/Space/tap opens a Stardew-style
  course menu (View Progress / Start Course placeholder / Leave).
- **NPCs** — 4 wandering NPCs (CEO, Head of People, IT Lead, Ops Manager);
  talk to them for rotating company fun facts in a Stardew dialog box with
  portraits.
- **Mobile** — virtual joystick (bottom-left) + "A" interact button
  (bottom-right), shown only on coarse-pointer devices.

## Session 2 — playtest fixes (2026-10-24)

Verified the full flow end-to-end in the browser (title → login → char select
→ town → NPC dialog → building hover → door → course menu) and fixed the
bugs found:

- **Ground rendered empty** — `buildGround()` drew tile canvases into a
  RenderTexture via `rt.draw(canvas)`, which silently no-ops for raw
  canvas elements. `tileset.png` now loads as a spritesheet and tiles are
  drawn with `rt.drawFrame('tiles', frame, x, y)`.
- **Player could walk while dialogs/menus were open** — destroyed Phaser
  games (React StrictMode remounts) leave zombie `TownScene` instances
  subscribed to `bus`. Their `ui-open` handler threw (`player` undefined),
  which killed the emit before it reached the live scene. Handlers are now
  named, removed by reference on shutdown, and guard on `sys.isActive()`.
- **Stale building tooltip** — hover was only recomputed on `pointermove`,
  so camera pans left a tooltip floating over whatever the cursor had been
  on. `update()` now re-evaluates the hover every frame from
  `input.activePointer`.
- **Door interact radius too tight** (`T*1.6`) — raised to `T*2.5`; the
  Enter hint and E/tap trigger are much friendlier.
- **Renderer** — switched `Phaser.AUTO` → `Phaser.CANVAS`: no WebGL features
  are used (no shaders/lights), and it sidesteps SwiftShader compositing
  stalls seen in headless/VM browsers.

## What's deliberately NOT done (later phases)

- **Minigames per course** — the "Start Course" button is a disabled
  placeholder. Game templates live on branches `game/dilemma`,
  `game/word-match`, `game/battle` — integrate later.
- **Dashboard integration** — `src/config.ts` already reads an
  `ob_courses` array from localStorage if present (id/name/completion),
  else falls back to 5 mock courses. Wire the manager dashboard's
  "Publish world" to write that key and link here.
- **Real auth / SSO** — login is a mock gate.
- **Dynamic logo** — `public/assets/logo.png` is baked for "Orthogonal";
  regenerate for other company names via `npm run assets -- "Company Name"`.
- Character *customization* (hair/clothes pickers) — currently variant cycling.

## How to run

```bash
cd world
npm install
npm run dev        # vite on http://localhost:5173
```

Build: `npm run build` (tsc + vite). Assets regenerate:
`python3 tools/gen_assets.py "<Company Name>"` (needs Pillow).

## Resources used

- **Repos**
  - `EthanYeung513/onBoardGameHack` — target repo (mockup: `login.html`
    design referenced for the login card).
  - `Dannode36/StardewValleyDecompiled` — referenced by the requester; note
    it contains **only decompiled C# + game-data JSON, no sprites/textures**
    (Stardew ships those as proprietary .xnb). All art here is recreated.
- **Deps**: Phaser 3.90, React 18, Vite 5, TypeScript 5, Pillow (asset gen).
- **Font**: `Stardew_Valley.ttf` (fan-made "Stardew Valley Regular") fetched
  from `github.com/gak5275/StardewDIGIT210` `docs/fonts/` — used both for
  UI text (@font-face `Stardew`) and the PIL logo render.
- **Assets in `world/public/assets/`**
  - `gen_assets.py` (PIL) produces: `tileset.png` (16px tiles: grass
    variants, dirt, water, tilled soil, stone, wood, cobble, dark grass,
    sand), buildings (`b_townhall/b_barn/b_cottage/b_green/b_shop/b_dojo`),
    `characters.png` (6 variants × 16 frames of 16×32), `npcs.png` (4×16×32),
    `portraits.png` (4×40×40), props (trees/bush/rock/fence/crops/sign/
    mailbox), `logo.png`.
  - `title_bg.png` — AI-generated pixel-art backdrop.
- **Devin's GITHUB_PAT** (personal secret, repo-write to this repo) used to
  push the branch.

## Architecture notes

- `src/App.tsx` — screen state machine (title/login/char/game).
- `src/config.ts` — company, courses (localStorage `ob_courses` hook),
  NPC roster + facts.
- `src/game/TownScene.ts` — the whole world: procedural tile ground rendered
  to a RenderTexture, building layout (`layout()`), collision set, NPC wander,
  hover/tap/E interactions. Emits events on `src/game/bridge.ts`'s `bus`
  (`hover-building`, `enter-building`, `npc-dialog`, `hint`, `ui-open`/`ui-close`)
  and reads joystick state from `input`.
- `src/components/Game.tsx` — mounts Phaser and the DOM overlays (tooltip,
  hint, NPC dialog, course menu, joystick, A-button).
- `src/styles.css` — Stardew chrome (`.sd-panel`, `.sd-btn`, `.sd-bar`).

## Known rough edges

- Logo is baked per-company via the gen script; regenerate or swap to a
  runtime canvas render if company names vary per deploy.
- NPC sprites only face down (single-frame); fine for wander, could add rows.
- Town hall door does nothing (it's not a course building) — could become
  a progress/overview screen later.
- `tsc -b` passes clean; no tests yet.

## Session 3 — real Stardew Valley assets (2026-10-24)

Replaced every generated placeholder with actual game sprites (extracted from
the SDV asset dump; see `tools/build_real_assets.py` — it takes the extracted
Content folder as argv[1] and composes `public/assets`).

- tileset.png: same 8x5 layout/indices, pixels now from `spring_outdoorsTileSheet`
  + `hoeDirt` (TILL). sign/mailbox/crops/bush/rock/fence cropped from real sheets.
- Buildings: `b_townhall` = farmhouse crop from `Buildings/houses.png`;
  courses use real Barn/Coop/Stable/Silo/Well sprites with per-building
  footprints (`SIZE` map in `TownScene.layout()`).
- Player: 6 real villager sheets `p0..p5` (Sam, Sebastian, Abigail, Emily,
  Maru, Alex). NPCs: `n0..n3` = Lewis, Gus, Harvey, Pierre + real 64x64
  portraits in `portraits.png`.
- Frame layout changed: SDV sheets are 4 cols x N rows of 16x32 —
  down 0-3 / right 4-7 / up 8-11 / left 12-15 (standing = first of each row).
- CharSelect loads `assets/p{row}.png`; dialog portraits are 64px cells.
- `logo.png` kept (already rendered in the real Stardew font). `title_bg.png`
  still AI-generated — swap for a real SDV background later if wanted.
