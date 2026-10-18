import { expect, test } from "@playwright/test";

test("versioned content and sidebar navigation work on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/docs/preview/");
    await expect(page.getByRole("heading", { name: "Kerangka Docs", exact: true })).toBeVisible();
    if (width === 375) await page.getByRole("button", { name: /menu/i }).click();
    await page.getByRole("link", { name: "Your First Model", exact: true }).first().click();
    await expect(page).toHaveURL(/\/docs\/preview\/getting-started\/first-model\/?$/);
    await expect(page.getByRole("heading", { name: "Your First Model", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prerequisites", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, `page overflow at ${width}px`).toBeLessThanOrEqual(0);
  }
  expect(errors).toEqual([]);
});

test("built Pagefind search opens a matching content page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/docs/preview/");
  await page.getByRole("button", { name: /search/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search", exact: true }).fill("validation");
  const result = dialog.getByRole("link").filter({ hasText: "Field, Expression, and Validation" }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/docs\/preview\/concepts\/validation\/?(?:#.*)?$/);
  await expect(page.getByRole("heading", { name: "Field, Expression, and Validation", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
