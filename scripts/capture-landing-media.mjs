#!/usr/bin/env node
// Regenerates the landing-page gameplay clips in public/assets/media/ (D-34) from OUR game builds.
//
// The games are not part of this repo. Check them out and run them first:
//   git worktree add /tmp/games origin/devin/1792879562-games-mubit-merge   # /games/{battle,dilemma,word-match}
//   (cd /tmp/games && npm install && npx next dev -p 3722)
//   git worktree add /tmp/world origin/devin/1792873985-stardew-world       # world/ Vite app (Stardew-style town)
//   (cd /tmp/world/world && npm install && npx vite --port 3721 --strictPort)
// Then:
//   node scripts/capture-landing-media.mjs [--games http://localhost:3722] [--world http://localhost:3721] [--only dilemma,battle,...] [--encode-only]
//
// Step 1 drives each game with scripted keyboard/mouse input (real gameplay, offline specs) under Playwright
// recordVideo and writes raw .webm + timing marks to RAW_DIR. Step 2 (scripts/landing-media-encode.mjs) cuts,
// crops and composes the slot clips with ffmpeg (H.264 mp4 + VP9 webm + poster).
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { encodeAll } from "./landing-media-encode.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const GAMES = arg("games", "http://localhost:3722");
const WORLD = arg("world", "http://localhost:3721");
export const RAW_DIR = arg("raw", "/tmp/landing-media-raw");
const only = arg("only", "")?.split(",").filter(Boolean);

const HIDE_DEV_UI = "nextjs-portal{display:none!important}";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Records one scenario: `drive(page, mark)` plays the game; `mark(name)` stamps seconds-since-recording-start. */
async function record(browser, name, { width, height }, drive) {
  const dir = join(RAW_DIR, `${name}-tmp`);
  rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: { dir, size: { width, height } } });
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = {};
  const mark = (m) => (marks[m] = (Date.now() - t0) / 1000);
  mark.extra = {};
  await drive(page, mark);
  await context.close();
  const [file] = readdirSync(dir);
  renameSync(join(dir, file), join(RAW_DIR, `${name}.webm`));
  rmSync(dir, { recursive: true, force: true });
  writeFileSync(join(RAW_DIR, `${name}.json`), JSON.stringify({ width, height, marks, ...mark.extra }, null, 2));
  console.log(name, marks);
}

const openGame = async (page, id) => {
  await page.goto(`${GAMES}/games/${id}`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: HIDE_DEV_UI });
  await sleep(1200);
  await page.getByText("New game").first().click({ force: true });
  await sleep(700);
};

/** Ace Attorney-style dilemma: read the urgent call, answer with the policy-correct option, OBJECTION! */
async function dilemma(page, mark) {
  await openGame(page, "dilemma");
  await page.getByText("BEGIN").first().click({ force: true });
  const best = page.getByRole("button", { name: /can't share MFA codes/ });
  for (let i = 0; i < 40 && !(await best.isVisible().catch(() => false)); i++) {
    await page.keyboard.press("Space");
    await sleep(900);
  }
  mark("choices");
  await sleep(1400);
  await best.click({ force: true });
  mark("pick");
  await sleep(4500);
  mark("end");
}

/** Pokemon-style battle: intro, answer the phishing question correctly, watch the hit land. */
async function battle(page, mark) {
  await openGame(page, "battle");
  mark("start");
  await page.getByText("Start battle").first().click({ force: true });
  const right = page.getByRole("button", { name: /Report phish/ });
  for (let i = 0; i < 30 && !(await right.isEnabled().catch(() => false)); i++) {
    await page.keyboard.press("Space");
    await sleep(1100);
  }
  mark("menu");
  await sleep(1200);
  await right.click({ force: true });
  mark("pick");
  for (let i = 0; i < 4; i++) {
    await sleep(1300);
    await page.keyboard.press("Space");
  }
  await sleep(1200);
  mark("end");
}

const PAIRS = {
  TTFT: "Time to first token",
  "p95 latency": "The slowest 5%",
  "Base URL": "Change it (and the API key)",
  "LoRA adapter": "Small trained matrices",
};

/** Word match: clear the first board, term then meaning, building a combo. */
async function wordMatch(page, mark) {
  await openGame(page, "word-match");
  await page.getByText("START").first().click({ force: true });
  await sleep(1500);
  mark("board");
  for (const [term, meaning] of Object.entries(PAIRS)) {
    await page.getByRole("button", { name: term, exact: true }).click({ force: true });
    await sleep(500);
    await page.getByRole("button", { name: new RegExp(meaning.replace(/[()]/g, "\\$&")) }).click({ force: true });
    await sleep(1000);
  }
  mark("cleared");
  await sleep(2000);
  mark("end");
}

// Lets the driver read player/NPC positions from the running Phaser scene (inputs stay real key presses).
const HOOK_SCENE = () => {
  const P = window.Phaser;
  const step = P.Scenes.Systems.prototype.step;
  P.Scenes.Systems.prototype.step = function (...a) {
    if (this.settings.key === "town") window.__town = this.scene;
    return step.apply(this, a);
  };
};

async function openWorld(page, zoom = 0) {
  await page.goto(`${WORLD}/?auto=1${zoom ? `&zoom=${zoom}` : ""}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.Phaser);
  await page.evaluate(HOOK_SCENE);
  await page.waitForFunction(() => !!window.__town?.player);
  await sleep(1500);
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__town;
    return {
      p: { x: s.player.x, y: s.player.y },
      npcs: s.npcs.filter((n) => n.sprite.active).map((n) => ({ name: n.spec.name, x: n.sprite.x, y: n.sprite.y })),
    };
  });

/** Holds arrow keys towards a target (re-aimed every 120ms) until within `near` px or timeout; sidesteps when stuck. */
async function walkTo(page, target, near = 24, timeout = 8000) {
  const held = new Set();
  const set = async (want) => {
    for (const k of [...held]) if (!want.has(k)) (await page.keyboard.up(k), held.delete(k));
    for (const k of want) if (!held.has(k)) (await page.keyboard.down(k), held.add(k));
  };
  const end = Date.now() + timeout;
  let last = null, stuck = 0;
  while (Date.now() < end) {
    const s = await state(page);
    const t = typeof target === "function" ? target(s) : target;
    const dx = t.x - s.p.x, dy = t.y - s.p.y;
    if (Math.hypot(dx, dy) < near) break;
    stuck = last && Math.hypot(s.p.x - last.x, s.p.y - last.y) < 1 ? stuck + 1 : 0;
    last = s.p;
    const want = new Set();
    if (stuck > 2) {
      // blocked: step along the other axis for a moment
      want.add(Math.abs(dx) > Math.abs(dy) ? (dy > 0 ? "ArrowDown" : "ArrowUp") : dx > 0 ? "ArrowRight" : "ArrowLeft");
      await set(want);
      await sleep(350);
      stuck = 0;
      continue;
    }
    if (Math.abs(dx) > 6) want.add(dx > 0 ? "ArrowRight" : "ArrowLeft");
    if (Math.abs(dy) > 6) want.add(dy > 0 ? "ArrowDown" : "ArrowUp");
    await set(want);
    await sleep(120);
  }
  await set(new Set());
}

const hold = async (page, key, ms) => {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
};

/** Stardew-style town: walk up to a townsperson and start a conversation. */
async function worldTalk(page, mark) {
  await openWorld(page, 3.4);
  // Step away across the plaza first so the clip starts with a walk.
  await hold(page, "ArrowDown", 900);
  await hold(page, "ArrowLeft", 1400);
  await sleep(500);
  mark("walk");
  const s0 = await state(page);
  const pick = s0.npcs.reduce((a, n) => (n.x > a.x ? n : a)); // the townsperson furthest right
  const npc = (s) => s.npcs.find((n) => n.name === pick.name && Math.hypot(n.x - pick.x, n.y - pick.y) < 200) ?? pick;
  await walkTo(page, npc, 26, 9000);
  await page.keyboard.press("e");
  mark("talk");
  await sleep(3500);
  mark("end");
  if (!(await page.locator(".dialog").isVisible())) throw new Error("world-talk: dialog did not open");
}

/** Stardew-style town: stand at a course building's door with its course tooltip showing ("Explore the world"). */
async function worldExplore(page, mark) {
  await openWorld(page);
  const door = await page.evaluate(() => {
    const s = window.__town;
    const T = 16;
    const d = s.doorZones.find((z) => z.course) ?? s.doorZones[0];
    return { x: d.x * T + T / 2, y: d.y * T + T / 2 + 20 };
  });
  await walkTo(page, door, 14, 15000);
  await page.keyboard.press("ArrowUp");
  await sleep(800);
  // Hover the building (as a player would) so its course tooltip shows.
  const hover = await page.evaluate(() => {
    const s = window.__town;
    const T = 16;
    const d = s.doorZones.find((z) => z.course) ?? s.doorZones[0];
    const bd = s.buildings.find((b) => b.doorX === d.x && b.doorY === d.y);
    const cam = s.cameras.main;
    const wx = (bd.x + bd.w / 2) * T, wy = (bd.y + bd.h / 2) * T;
    return { x: (wx - cam.worldView.x) * cam.zoom, y: (wy - cam.worldView.y) * cam.zoom };
  });
  await page.mouse.move(hover.x, hover.y, { steps: 8 });
  await sleep(800);
  mark("door");
  await page.screenshot({ path: join(RAW_DIR, "world-explore.png") });
  // Where the course tooltip and the hire are on screen, for the encoder's crop.
  const tip = await page.locator(".tooltip").boundingBox();
  const me = await page.evaluate(() => {
    const s = window.__town, cam = s.cameras.main;
    return { x: (s.player.x - cam.worldView.x) * cam.zoom, y: (s.player.y - cam.worldView.y) * cam.zoom };
  });
  Object.assign(mark.extra, { tip, me });
  await sleep(1500);
  mark("end");
}

const SCENARIOS = {
  dilemma: [{ width: 1280, height: 720 }, dilemma],
  battle: [{ width: 900, height: 900 }, battle],
  "word-match": [{ width: 720, height: 900 }, wordMatch],
  "world-talk": [{ width: 650, height: 1000 }, worldTalk],
  "world-explore": [{ width: 900, height: 1000 }, worldExplore],
};

if (!process.argv.includes("--encode-only")) {
  mkdirSync(RAW_DIR, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, [size, drive]] of Object.entries(SCENARIOS)) {
    if (only?.length && !only.includes(name)) continue;
    await record(browser, name, size, drive);
  }
  await browser.close();
}
await encodeAll(RAW_DIR);
