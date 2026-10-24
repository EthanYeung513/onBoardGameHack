import { expect, test, type Page } from "@playwright/test";
import { flowReducer, initFlowState, type AnswerValue } from "../src/lib/flow/scoring";
import type { FlowSpec, Step } from "../src/lib/flow/spec";
import { signIn, watchErrors } from "./helpers";

// Runs the whole pipeline through the UI against a real public website, once with a live crawl and
// once reusing the cached crawl. Set E2E_SITE to change the site.
const SITE = process.env.E2E_SITE ?? "https://www.mubit.ai";

type State = {
  project: { id: string; stage: string; status: string };
  pages: Array<{ status: string; fetch_method: string }>;
  screenshots: unknown[];
  tokens: { tokens_json: unknown } | null;
  model: { confirmed_at: string | null } | null;
  flows: Array<{ id: string; variant_key: string; version: number; status: string; spec_json: FlowSpec }>;
};

async function state(page: Page, id: string): Promise<State> {
  const r = await page.request.get(`/api/gen/projects/${id}/state`);
  expect(r.ok()).toBe(true);
  return r.json();
}

async function waitForStage(page: Page, id: string, stages: string[], timeoutMs: number) {
  const start = Date.now();
  for (;;) {
    const s = await state(page, id);
    if (stages.includes(s.project.stage)) return s;
    expect(s.project.status, `pipeline ${s.project.status} at ${s.project.stage}`).not.toBe("failed");
    expect(Date.now() - start, `timed out waiting for ${stages.join("/")}, at ${s.project.stage}`).toBeLessThan(timeoutMs);
    await page.waitForTimeout(3000);
  }
}

/** The answer the test gives for each step, chosen so the result is fully predictable. */
function answerFor(step: Step): AnswerValue {
  switch (step.type) {
    case "single_choice":
      return step.options[0].id;
    case "multiple_choice":
      return step.options.slice(0, step.minSelect ?? 1).map((o) => o.id);
    case "checklist":
      return step.items.map((i) => i.id);
    case "quiz_question":
      return step.correctOptionIds;
    case "text_input":
      return "Test User";
    case "email_signup":
      return `e2e+${Date.now()}@example.com`;
    default:
      return true;
  }
}

async function playThrough(page: Page, spec: FlowSpec) {
  let model = initFlowState(spec);
  for (let guard = 0; guard < 30; guard++) {
    const step = spec.steps[model.currentIndex];
    const root = page.getByTestId(`flow-step-${step.id}`);
    await expect(root).toBeVisible();
    const answer = answerFor(step);
    if (step.type === "text_input" || step.type === "email_signup") await page.getByTestId("flow-input").fill(String(answer));
    else if (Array.isArray(answer)) for (const id of answer) await page.getByTestId(`flow-option-${id}`).click();
    else if (typeof answer === "string") await page.getByTestId(`flow-option-${answer}`).click();
    if (answer !== true) model = flowReducer(model, { type: "answer", value: answer });
    if (step.type === "reward") break;
    // Quiz steps check the answer first, then continue.
    await page.getByTestId("flow-next").click();
    if (step.type === "quiz_question" && (await root.isVisible())) await page.getByTestId("flow-next").click();
    model = flowReducer(model, { type: "next" });
  }
  return model;
}

for (const mode of ["live", "cached"] as const) {
  test(`full pipeline (${mode} crawl)`, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const errors = watchErrors(page);
    await signIn(page);
    await page.getByTestId("new-project-url").fill(SITE);
    if (mode === "cached") {
      await expect(page.getByTestId("use-cached-crawl")).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("use-cached-crawl").click();
    } else {
      await page.getByTestId("new-project-submit").click();
    }
    await page.waitForURL(/\/studio\/projects\//);
    const id = page.url().split("/").pop()!;
    await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-timeline.png` });

    let s = await waitForStage(page, id, ["awaiting_confirmation"], 6 * 60_000);
    expect(s.pages.filter((p) => p.status === "fetched").length).toBeGreaterThan(2);
    if (mode === "cached") expect(s.pages.every((p) => p.fetch_method === "cache")).toBe(true);
    expect(s.screenshots.length).toBeGreaterThan(0);
    expect(s.tokens).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("findings")).toBeVisible();
    await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-findings.png`, fullPage: true });
    await page.getByTestId("confirm-findings").click();

    s = await waitForStage(page, id, ["awaiting_answers"], 3 * 60_000);
    await page.reload();
    const questions = page.locator("[data-testid^='question-']");
    await expect(questions.first()).toBeVisible();
    const n = await questions.count();
    expect(n).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < n; i++) await questions.nth(i).locator("button").first().click();
    await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-questions.png`, fullPage: true });
    await page.getByTestId("submit-answers").click();

    s = await waitForStage(page, id, ["ready"], 8 * 60_000);
    await page.waitForTimeout(3000);
    s = await state(page, id);
    expect(s.project.status).toBe("ready");
    expect(s.flows.map((f) => f.variant_key).sort()).toEqual(["quest", "quiz", "streak"]);
    for (const f of s.flows) expect(f.status).toBe("valid");

    // Each flow can be completed, and the points shown match the deterministic rules.
    await page.reload();
    for (const f of s.flows) {
      await page.getByTestId(`variant-${f.variant_key}`).click();
      const final = await playThrough(page, f.spec_json);
      if (f.spec_json.gamification.mechanics.points) await expect(page.getByTestId("flow-points")).toContainText(String(final.points));
      await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-flow-${f.variant_key}-end.png` });
    }

    // A chat change creates a new version.
    const quest = s.flows.find((f) => f.variant_key === "quest")!;
    await page.getByTestId("variant-quest").click();
    await page.getByTestId("tab-chat").click();
    await page.getByTestId("chat-input").fill(`Change the transition of the step "${quest.spec_json.steps[1].id}" to fade.`);
    await page.getByTestId("chat-send").click();
    await expect(page.getByTestId("latest-version")).toContainText(`Version ${quest.version + 1}`, { timeout: 180_000 });
    await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-chat.png` });

    // Memory calls were logged.
    await page.getByTestId("tab-memory").click();
    await expect(page.getByTestId("memory-events").locator("li").first()).toBeVisible({ timeout: 30_000 });
    expect(await page.getByTestId("memory-events").locator("li").count()).toBeGreaterThan(3);
    await page.screenshot({ path: `artifacts/screenshots/e2e-${mode}-memory.png` });

    expect(errors).toEqual([]);
  });
}
