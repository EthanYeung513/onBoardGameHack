// Signs in and captures the key screens. Usage: node e2e/screens.mjs <baseUrl> <prefix> [projectId]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const prefix = process.argv[3] ?? "m1";
const projectId = process.argv[4];
const email = process.env.E2E_EMAIL ?? "team@onboarding-studio.dev";
const password = process.env.E2E_PASSWORD ?? "OnboardStudio-2026";
mkdirSync("artifacts/screenshots", { recursive: true });

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("requestfailed", (r) => errors.push(`failed ${r.url()} ${r.failure()?.errorText}`));
const shot = async (name) => {
  await page.screenshot({ path: `artifacts/screenshots/${prefix}-${name}.png`, fullPage: true });
  console.log(`saved artifacts/screenshots/${prefix}-${name}.png`);
};

await page.goto(`${base}/studio`, { waitUntil: "networkidle" });
await shot("login");
await page.getByTestId("login-email").fill(email);
await page.getByTestId("login-password").fill(password);
await page.getByTestId("login-submit").click();
await page.waitForURL(/\/studio/, { timeout: 30000 });
await page.waitForLoadState("networkidle");
await shot("studio");
if (projectId) {
  await page.goto(`${base}/studio/projects/${projectId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await shot("project");
  if (process.argv.includes("--flows")) {
    await page.getByTestId("flows").scrollIntoViewIfNeeded();
    await page.locator('[data-testid="flow-preview"]').screenshot({ path: `artifacts/screenshots/${prefix}-flow-quest-step1.png` });
    console.log(`saved artifacts/screenshots/${prefix}-flow-quest-step1.png`);
    for (const v of ["quiz", "streak"]) {
      await page.getByTestId(`variant-${v}`).click();
      await page.waitForTimeout(800);
      await page.locator('[data-testid="flow-preview"]').screenshot({ path: `artifacts/screenshots/${prefix}-flow-${v}-step1.png` });
      console.log(`saved artifacts/screenshots/${prefix}-flow-${v}-step1.png`);
    }
    for (const t of ["files", "memory"]) {
      await page.getByTestId(`tab-${t}`).click();
      await page.getByTestId(`${t}-tab`).waitFor({ timeout: 60000 });
      await page.waitForTimeout(t === "files" ? 2500 : 500);
      await page.locator('[data-testid="flows"]').screenshot({ path: `artifacts/screenshots/${prefix}-${t}.png` });
      console.log(`saved artifacts/screenshots/${prefix}-${t}.png`);
    }
  }
}
if (process.argv.includes("--status")) {
  await page.goto(`${base}/status`, { waitUntil: "networkidle", timeout: 120000 });
  await shot("status");
}
console.log(errors.length ? `console/network errors:\n${errors.join("\n")}` : "no console or network errors");
await browser.close();
