import { expect, test } from "@playwright/test";
import { signIn, watchErrors } from "./helpers";

// The constructor at "/" driven against the live backend: scan, skip GitHub, describe, review the
// findings, build, and publish. Set E2E_CONSTRUCTOR_SITE to change the site.
const SITE = process.env.E2E_CONSTRUCTOR_SITE ?? "pypi.org";

test("constructor builds and publishes a live onboarding", async ({ page }) => {
  test.setTimeout(12 * 60_000);
  const errors = watchErrors(page);
  await signIn(page, "/");
  await page.getByLabel("Start with your website").fill(SITE);
  await page.getByRole("button", { name: /Scan my site/ }).click();

  await expect(page.getByRole("heading", { name: /Reading your/ })).toBeVisible();
  await expect(page.getByTestId("live-log").locator("li").nth(2)).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-scan.png", caret: "initial" });

  await expect(page.getByRole("button", { name: "Skip for now" })).toBeVisible({ timeout: 6 * 60_000 });
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("heading", { name: /^We think / })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-describe.png", caret: "initial" });
  await page.getByLabel("Describe your users").fill("Most new users are Python developers publishing their first package.");
  await page.getByRole("button", { name: "Use my description" }).click();

  await expect(page.getByRole("button", { name: /Build the onboarding/ })).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-findings.png", fullPage: true, caret: "initial" });
  await page.getByRole("button", { name: /Build the onboarding/ }).click();

  await expect(page.getByRole("heading", { name: /Writing your/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-building.png", caret: "initial" });
  await expect(page.getByRole("button", { name: "Publish" })).toBeVisible({ timeout: 6 * 60_000 });
  await page.waitForTimeout(2500); // the workbench plays a short opening animation
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-workbench.png", caret: "initial" });

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  const detail = await page.locator("text=/\\/f\\/[0-9a-f-]{36}/").first().textContent();
  const flowPath = detail!.match(/\/f\/[0-9a-f-]{36}/)![0];
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-published.png", caret: "initial" });

  await page.goto(flowPath);
  await expect(page.getByTestId("flow-root")).toBeVisible();
  await page.screenshot({ path: "artifacts/screenshots/m5-constructor-public-flow.png", caret: "initial" });
  expect(errors).toEqual([]);
});
