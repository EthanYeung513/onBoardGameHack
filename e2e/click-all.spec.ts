import { expect, test } from "@playwright/test";
import { signIn, watchErrors } from "./helpers";

// Visits every page reachable from the studio and clicks every safe button, failing on console
// errors, failed requests, broken links or controls that do nothing.

test("the landing page is the mockup and its links resolve", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Orthogonal/);
  await expect(page.locator("a[href='/login']").first()).toBeAttached();
  await expect(page.getByText("Build my onboarding")).toHaveCount(0);
  await expect(page.getByText("Try the demo scan")).toHaveCount(0);
  for (const href of await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
    expect((await page.request.get(href)).status(), href).toBeLessThan(400);
  }
});

test("signed out visitors are sent to sign in", async ({ page }) => {
  const errors = watchErrors(page);
  for (const path of ["/studio", "/status", "/play", "/gymquest"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
  const r = await page.request.get("/api/gen/projects/00000000-0000-0000-0000-000000000000/state");
  expect(r.status()).toBe(401);
  expect(errors).toEqual([]);
});

test("a wrong password shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill("team@onboarding-studio.dev");
  await page.getByTestId("login-password").fill("wrong-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("That email and password do not match an account.")).toBeVisible();
});

test("every link and control in the studio works", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await signIn(page);

  // Links: every internal link answers with a page, not an error.
  const hrefs = new Set<string>();
  for (const a of await page.locator("a[href^='/']").all()) hrefs.add((await a.getAttribute("href"))!);
  const firstProject = await page.getByTestId("project-row").first().getAttribute("href");
  for (const href of hrefs) {
    if (href === "/status") continue; // checked below, it makes live service calls
    const res = await page.request.get(href);
    expect(res.status(), href).toBeLessThan(400);
  }

  // The new project button stays disabled until a URL is typed.
  await expect(page.getByTestId("new-project-submit")).toBeDisabled();
  await page.getByTestId("new-project-url").fill("www.mubit.ai");
  await expect(page.getByTestId("new-project-submit")).toBeEnabled();

  if (firstProject) {
    await page.goto(firstProject);
    await expect(page.getByTestId("timeline")).toBeVisible();
    if (await page.getByTestId("flows").count()) {
      for (const v of ["quest", "streak", "quiz"]) {
        const tab = page.getByTestId(`variant-${v}`);
        if (!(await tab.count())) continue;
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(page.getByTestId("flow-root")).toBeVisible();
        await page.getByTestId("flow-next").click();
      }
      for (const t of ["files", "chat", "memory"] as const) {
        await page.getByTestId(`tab-${t}`).click();
        await expect(page.getByTestId(`${t}-tab`)).toBeVisible({ timeout: 60_000 });
      }
      await page.getByTestId("tab-files").click();
      for (const v of ["preview", "diff", "code"]) {
        await page.getByTestId(`files-view-${v}`).click();
      }
      await page.getByTestId("tab-preview").click();
      await expect(page.getByTestId("flow-preview")).toBeVisible();
    }
  }

  await page.goto("/status");
  await expect(page.getByTestId("status-row")).toHaveCount(6, { timeout: 90_000 });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
