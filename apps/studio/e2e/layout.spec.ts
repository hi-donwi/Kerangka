import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio, type StudioHost } from "../../../packages/studio-server/dist/index.js";

/**
 * The page designer at a narrow width, and the geometry of its controls.
 *
 * The console is used on a laptop and on a tablet, and the workbench panels are the
 * part that has to survive a narrow viewport without a horizontal scrollbar and without
 * controls that are too small to hit.
 */

let root: string;
let host: StudioHost;
let model: string;

const help = () => ({
  version: "1.0",
  id: "help",
  name: "Synthetic Help",
  root: {
    id: "help-root",
    type: "Container",
    children: [
      { id: "help-text", type: "Text", props: { value: "Synthetic help" } },
      { id: "no-call", type: "Button", props: { label: "Do not call" } },
    ],
  },
});

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kerangka-studio-narrow-"));
  model = await readFile(
    new URL("../../../packages/cli/test/fixtures/studio/approval.kerangka.json", import.meta.url),
    "utf8",
  );
  await writeFile(join(root, "app.kerangka.json"), model);
  await writeFile(join(root, "help.uidl.json"), JSON.stringify(help()));
  host = await startStudio({ target: root, port: 0 });
});
test.afterAll(async () => {
  await host?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("keeps the page designer usable at 320px without a horizontal scrollbar", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(host.url);
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /help\.uidl\.json/ })
    .click();

  const tree = page.getByRole("region", { name: "Page tree" });
  await expect(tree).toBeVisible();
  await tree.getByRole("button", { name: "Text help-text" }).click();
  await expect(page.getByRole("region", { name: "Typed property fields" })).toBeVisible();

  // Nothing may push the page wider than the viewport.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The controls a person has to hit are large enough to hit.
  const apply = page.getByRole("form", { name: "value property" }).getByRole("button", { name: "Apply value" });
  const box = await apply.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  await page.screenshot({ path: test.info().outputPath("narrow.png"), fullPage: true });
});

test("keeps the layer tree and the inspector side by side at a wide width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(host.url);
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /help\.uidl\.json/ })
    .click();

  const tree = page.getByRole("region", { name: "Page tree" });
  const catalog = page.getByRole("region", { name: "Page component catalog" });
  const treeBox = await tree.boundingBox();
  const catalogBox = await catalog.boundingBox();
  // Two columns, not one long scroll: the catalog is beside the tree.
  expect(catalogBox?.x ?? 0).toBeGreaterThan(treeBox?.x ?? 0);
  expect(treeBox?.y ?? 0).toBe(catalogBox?.y ?? -1);
  await page.screenshot({ path: test.info().outputPath("wide.png"), fullPage: false });
});
