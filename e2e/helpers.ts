import { expect, type Page } from "@playwright/test";

export const EMAIL = process.env.E2E_EMAIL ?? "team@onboarding-studio.dev";
export const PASSWORD = process.env.E2E_PASSWORD ?? "OnboardStudio-2026";

/** Collects console errors and failed requests so a test can fail on them. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    const t = r.failure()?.errorText ?? "";
    // Navigations and prefetches cancelled by a redirect are not failures.
    if (!t.includes("ERR_ABORTED")) errors.push(`failed: ${r.url()} ${t}`);
  });
  return errors;
}

export async function signIn(page: Page, next = "/studio") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((u) => u.pathname === next);
  if (next === "/studio") await expect(page.getByRole("heading", { name: "Start from a website" })).toBeVisible();
}
