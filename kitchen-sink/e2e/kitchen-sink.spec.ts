import { expect, test } from "@playwright/test";

const SAMPLES = 3;
const JS_BUDGET_BYTES = 400 * 1024;

test.describe("kitchen sink preview", () => {
  test("golden path: samples list, select, detail, and preview-only note", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));

    await page.goto("/");
    await expect(page.locator("h1")).toHaveText("Kerangka Kitchen Sink");

    const nav = page.getByRole("navigation", { name: "samples" });
    await expect(nav.getByRole("button")).toHaveCount(SAMPLES);

    await expect(page.locator("section.sample h2")).toHaveText("Expense Approval");
    await expect(page.getByText("preview-only in this P0 slice", { exact: false })).toBeVisible();

    await nav.getByRole("button", { name: "Action, Workflow, and Decision" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");
    await expect(page.getByRole("heading", { name: "Expected outcomes" })).toBeVisible();

    await nav.getByRole("button", { name: "Field, Expression, and Validation" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Field, Expression, and Validation");

    const mutating = requests.filter((m) => !m.startsWith("GET ") && !m.startsWith("HEAD "));
    expect(mutating, "preview mode must not send mutating requests").toEqual([]);

    const crossOrigin = requests.filter(
      (m) => !m.includes("127.0.0.1:4173") && !m.includes("localhost:4173"),
    );
    expect(crossOrigin, "preview mode must not call third-party hosts").toEqual([]);
  });

  test("reset: reload returns to the default sample", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "samples" });
    await nav.getByRole("button", { name: "Action, Workflow, and Decision" }).click();
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");

    await page.reload();
    await expect(page.locator("section.sample h2")).toHaveText("Expense Approval");
  });

  test("mobile viewport renders without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, "page must not scroll horizontally at 375px").toBeLessThanOrEqual(0);
    await expect(page.getByRole("navigation", { name: "samples" }).getByRole("button").first()).toBeVisible();
  });

  test("keyboard: tab reaches samples, Enter selects, focus stays visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");

    const nav = page.getByRole("navigation", { name: "samples" });
    const firstButton = nav.getByRole("button").first();
    await expect(firstButton).toBeFocused();

    const outline = await firstButton.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.outlineStyle}:${s.outlineWidth}`;
    });
    expect(outline, "focused sample button needs a visible outline").not.toContain("none");

    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("section.sample h2")).toHaveText("Action, Workflow, and Decision");

    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(activeTag).toBe("BUTTON");
  });

  test("execution budget: static assets stay under the JS budget", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation", { name: "samples" }).getByRole("button").last().click();

    const jsBytes = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((r) => r.name.endsWith(".js"))
        .reduce((sum, r) => sum + (r as PerformanceResourceTiming).encodedBodySize, 0),
    );
    expect(jsBytes, "JS transfer budget").toBeGreaterThan(0);
    expect(jsBytes, "JS transfer budget").toBeLessThan(JS_BUDGET_BYTES);
  });
});
