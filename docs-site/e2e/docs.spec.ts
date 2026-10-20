import { expect, test, type Page } from "@playwright/test";

const MID_TIER_TTI_MS = 8000;

async function applyMidTierMobile(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 823,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}
import manifest from "../../samples/manifest.json" with { type: "json" };

test("versioned content and sidebar navigation work on desktop and mobile", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto("/Kerangka/docs/v0.1.1/");
    await expect(page.getByRole("heading", { name: "Kerangka Docs", exact: true })).toBeVisible();
    if (width === 375) await page.getByRole("button", { name: /menu/i }).click();
    await page.getByRole("link", { name: "Your First Model", exact: true }).first().click();
    await expect(page).toHaveURL(/\/Kerangka\/docs\/v0\.1\.1\/getting-started\/first-model\/?$/);
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
  await page.goto("/Kerangka/docs/v0.1.1/");
  await page.getByRole("button", { name: /search/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Search", exact: true }).fill("validation");
  const result = dialog.getByRole("link").filter({ hasText: "Field, Expression, and Validation" }).first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(/\/Kerangka\/docs\/v0\.1\.1\/concepts\/validation\/?(?:#.*)?$/);
  await expect(page.getByRole("heading", { name: "Field, Expression, and Validation", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mid-tier mobile profile becomes interactive within the TTI ceiling", async ({ page }) => {
  await applyMidTierMobile(page);
  await page.goto("/Kerangka/docs/v0.1.1/", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Kerangka Docs", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /menu/i })).toBeVisible();
  const tti = await page.evaluate(() => performance.now());
  expect(tti, "mid-tier mobile TTI").toBeGreaterThan(0);
  expect(tti, "mid-tier mobile TTI").toBeLessThan(MID_TIER_TTI_MS);
});

test("reference catalogue and usability protocol are published", async ({ page }) => {
  await page.goto("/Kerangka/docs/v0.1.1/reference/applications/");
  await expect(page.getByRole("heading", { name: "Reference Applications", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "samples reference", exact: true })).toBeVisible();
  await page.goto("/Kerangka/docs/v0.1.1/reference/usability-protocol/");
  await expect(page.getByRole("heading", { name: "Learner Usability Protocol", exact: true })).toBeVisible();
});

test("every manifest docs link opens a built content page", async ({ page }) => {
  for (const entry of manifest) {
    const response = await page.goto(entry.docsPath);
    expect(response?.status(), entry.id).toBe(200);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
});
