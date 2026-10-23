// Usage: npm run smoke -- [--url http://localhost:3000] [--out <screenshot dir>]
// Drives the real app in Edge (or Chrome with --channel chrome): join, walk to the Support Gym, battle,
// then check the grade reached the manager's review queue. Exits non-zero on any failure or console error.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "playwright-core";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000" },
    out: { type: "string", default: path.join(".data", "smoke") },
    channel: { type: "string", default: "msedge" },
    headed: { type: "boolean", default: false },
  },
});
const base = values.url!;
mkdirSync(values.out!, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(values.out!, `${name}.png`) });

async function stepKey(page: Page, key: string, times: number) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(90);
    await page.keyboard.up(key);
    await page.waitForTimeout(220);
  }
}

const browser = await chromium.launch({ channel: values.channel, headless: !values.headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

try {
  await page.goto(`${base}/play`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByLabel("Your name").fill("Smoke Test");
  await page.getByLabel("Your role").selectOption("Customer Support");
  await page.getByRole("button", { name: "Start onboarding" }).click();
  await page.locator("[data-testid=game-host] canvas").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "1-world");
  console.log("✓ world rendered");

  // Spawn is (15,6) on the path; the Support Gym door is at (26,4).
  await page.locator("[data-testid=game-host] canvas").click();
  await stepKey(page, "ArrowRight", 11);
  await stepKey(page, "ArrowUp", 2);
  await page.getByRole("dialog").waitFor({ timeout: 5000 });
  await shot(page, "2-gym-intro");
  console.log("✓ entered the Support Gym");

  await page.getByRole("button", { name: "Battle the trainers" }).click();
  for (let turn = 0; turn < 10; turn++) {
    const done = page.getByText(/fainted!|blacked out/);
    if (await done.isVisible().catch(() => false)) break;
    const answer = page.getByLabel("Your answer");
    await page.locator("[role=dialog] button, [role=dialog] textarea").first().waitFor();
    if (await answer.isVisible().catch(() => false)) {
      await answer.fill("I'd call the merchant back on the phone number on file, have them approve it in the app with 2FA, and flag it to fraud.");
      await page.getByRole("button", { name: "Attack!" }).click();
    } else {
      await page.locator("[role=dialog] .grid button").nth(2).click();
    }
    await page.getByTestId("grade-display").waitFor({ timeout: 20000 });
    if (turn === 1) await shot(page, "3-grade");
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await shot(page, "4-battle-end");
  console.log(`✓ battle finished: ${(await page.getByText(/fainted!|blacked out/).textContent()) ?? "?"}`);

  await page.goto(`${base}/admin`);
  await page.getByText("Smoke Test").first().waitFor({ timeout: 10000 });
  await shot(page, "5-review-queue");
  console.log("✓ grade visible in the manager review queue");

  // Fast refresh: upload the sample pack unless the annex is already taken (e.g. a second run).
  const learnerId = await page.evaluate(() => localStorage.getItem("gymquest.learnerId"));
  const before = await (await page.request.get(`${base}/api/world?learnerId=${learnerId}`)).json();
  if (before.locked.includes("annex")) {
    await page.getByRole("button", { name: "Content" }).click();
    await page.getByRole("button", { name: "Load sample: Warehouse Ops" }).click();
    await page.getByLabel("Pack title").waitFor();
    await page.waitForFunction(() => (document.querySelector("textarea") as HTMLTextAreaElement | null)?.value.includes("warehouse"));
    await page.getByRole("button", { name: "Generate gym" }).click();
    await page.getByRole("status").filter({ hasText: "is open in the annex" }).waitFor({ timeout: 60000 });
    await shot(page, "6-pack-uploaded");
    const after = await (await page.request.get(`${base}/api/world?learnerId=${learnerId}`)).json();
    if (after.locked.includes("annex")) throw new Error("annex still locked after upload");
    console.log("✓ new pack generated and the annex opened");
  } else {
    console.log("· annex already open, skipped the upload");
  }
  await page.goto(`${base}/play`);
  await page.locator("[data-testid=game-host] canvas").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, "7-world-after-upload");

  if (errors.length) throw new Error(`Console errors:\n${errors.join("\n")}`);
  console.log(`Smoke test passed. Screenshots in ${values.out}`);
} catch (err) {
  await shot(page, "failure").catch(() => {});
  console.error(`Smoke test failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
