import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio, type StudioHost } from "../../../packages/studio-server/dist/index.js";

let root: string;
let host: StudioHost;
let model: string;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kerangka-studio-acceptance-"));
  model = await readFile(
    new URL("../../../packages/cli/test/fixtures/studio/approval.kerangka.json", import.meta.url),
    "utf8",
  );
  await writeFile(join(root, "app.kerangka.json"), model);
  host = await startStudio({ target: root, port: 0, writable: true });
});

test.afterAll(async () => {
  await host?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("acceptance: employee submits, manager approves, employee approval is denied", async ({ page }) => {
  await page.goto(host.url);
  await expect(page.getByText("WRITABLE HOST", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Entities" }).getByRole("button", { name: /^Request/ }).click();
  const form = page.getByRole("form", { name: /Add a field to Request/ });
  await form.getByLabel("New field name", { exact: true }).fill("note");
  await form.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText("UNSAVED DRAFT", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/saved to disk/)).toBeVisible();
  const saved = JSON.parse(await readFile(join(root, "app.kerangka.json"), "utf8"));
  expect(saved.entities.Request.fields.note).toBe("string?");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("acceptance: external save conflict preserves both versions", async ({ page }) => {
  await writeFile(join(root, "app.kerangka.json"), model);
  await page.goto(host.url);
  await page.getByRole("navigation", { name: "Entities" }).getByRole("button", { name: /^Request/ }).click();
  const form = page.getByRole("form", { name: /Add a field to Request/ });
  await form.getByLabel("New field name", { exact: true }).fill("note");
  await form.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText("UNSAVED DRAFT", { exact: true })).toBeVisible();
  const external = JSON.parse(model);
  external.entities.Request.fields.external = "string";
  await writeFile(join(root, "app.kerangka.json"), JSON.stringify(external, null, 2));
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const panel = page.getByRole("alert", { name: "Revision conflict" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("YOUR DRAFT");
  await expect(panel).toContainText("FILE ON DISK");
  await panel.getByRole("button", { name: "Keep the file on disk" }).click();
  await expect(page.getByText(/file on disk was kept/)).toBeVisible();
  const kept = JSON.parse(await readFile(join(root, "app.kerangka.json"), "utf8"));
  expect(kept.entities.Request.fields.external).toBe("string");
  expect(kept.entities.Request.fields.note).toBeUndefined();
});
