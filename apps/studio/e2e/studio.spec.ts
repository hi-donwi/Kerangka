import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { startStudio, type StudioHost } from "../../../packages/studio-server/dist/index.js";

let root: string;
let host: StudioHost;
let model: string;
const help = () => ({
  version: "1.0",
  id: "help",
  name: "Synthetic Help",
  state: { record: { marker: "PRIVATE_RECORD_MARKER" } },
  dataSources: { records: [{ marker: "PRIVATE_RECORD_MARKER" }] },
  root: {
    id: "help-root",
    type: "Container",
    children: [
      { id: "help-text", type: "Text", props: { value: "Synthetic help" } },
      {
        id: "no-call",
        type: "Button",
        props: { label: "Do not call" },
        events: { onClick: [{ api: { url: "https://forbidden.invalid" } }] },
      },
    ],
  },
});

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "kerangka-studio-browser-"));
  model = await readFile(
    new URL("../../../packages/cli/test/fixtures/studio/approval.kerangka.json", import.meta.url),
    "utf8",
  );
  await writeFile(join(root, "app.kerangka.json"), model);
  host = await startStudio({ target: root, port: 0 });
});
test.beforeEach(async () => {
  await writeFile(join(root, "app.kerangka.json"), model);
  await writeFile(join(root, "help.uidl.json"), JSON.stringify(help()));
});
test.afterAll(async () => {
  await host?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("opens the real explorer, entity/API/schema views, and generated UIDL without writes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(host.url);
  await expect(page.getByRole("heading", { name: "Synthetic Request Approval", exact: true })).toBeVisible();
  await expect(page.getByText("READ ONLY", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Entities" })
    .getByRole("button", { name: /^Request/ })
    .click();
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("employeeId");
  await expect(page.getByText("Guarded", { exact: false }).first()).toBeVisible();
  await page.getByRole("tab", { name: "REST API", exact: true }).click();
  await expect(page.getByRole("region", { name: "Derived output" })).toContainText("/api/request");
  await page.getByRole("tab", { name: "PostgreSQL", exact: true }).click();
  await expect(page.getByRole("region", { name: "Derived output" })).toContainText("CREATE TABLE");
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /^requests / })
    .click();
  await expect(page.frameLocator("iframe").getByText("Synthetic Request 1", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /^request form$/ })
    .click();
  await expect(page.frameLocator("iframe").getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await test.info().attach("generated-form-accessibility", {
    body: await page.frameLocator("iframe").locator("body").ariaSnapshot(),
    contentType: "text/plain",
  });
  await expect(page.frameLocator("iframe").getByRole("textbox", { name: /^Title\b/ })).toHaveValue(
    "Synthetic Request 1",
  );
  await expect(page.frameLocator("iframe").getByRole("textbox", { name: /^Title\b/ })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("desktop.png"), fullPage: true });
  expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(model);
  expect(errors).toEqual([]);
});

test("links compiler diagnostics to source and recovers after an external fix", async ({ page }) => {
  await writeFile(
    join(root, "app.kerangka.json"),
    '{\n "kerangka":"0.1",\n "app":"broken",\n "entities":{"Request":{"fields":{"title":{"required":true}}}}\n}',
  );
  await page.goto(host.url);
  const diagnostics = page.getByRole("region", { name: "Diagnostics" });
  await diagnostics.getByRole("button", { name: /MISSING_FIELD_TYPE/ }).click();
  await expect(page.getByRole("region", { name: "Source text" }).locator("mark")).toContainText('"required":true');
  await expect(page.getByRole("region", { name: "Source text" })).not.toContainText(root);
  await writeFile(join(root, "app.kerangka.json"), model);
  await page.getByRole("button", { name: "Refresh source", exact: true }).click();
  await expect(diagnostics).toContainText("No source diagnostics");
  await expect(
    page.getByRole("navigation", { name: "Entities" }).getByRole("button", { name: /^Request/ }),
  ).toBeVisible();
});

test("isolates the real renderer, refuses egress/forged messages, and supports frame reload", async ({ page }) => {
  const requests: string[] = [];
  const sink = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end("unexpected");
  });
  await new Promise<void>((resolve) => sink.listen(0, "127.0.0.1", resolve));
  const address = sink.address();
  if (!address || typeof address === "string") throw new Error("No synthetic sink address");
  try {
    await page.goto(host.url);
    await page
      .getByRole("navigation", { name: "Screens" })
      .getByRole("button", { name: /help\.uidl\.json/ })
      .click();
    const content = page.frameLocator("iframe");
    await expect(content.getByText("Synthetic help", { exact: true })).toBeVisible();
    await expect(content.getByRole("button", { name: "Do not call" })).toBeDisabled();
    const child = page.frames().find((frame) => frame.url().includes("/preview.html"))!;
    expect(child.url()).not.toContain(host.token);
    expect(await child.evaluate(() => self.origin)).toBe("null");
    expect(
      await child.evaluate(() => {
        try {
          return Boolean(window.parent.document.body);
        } catch {
          return false;
        }
      }),
    ).toBe(false);
    expect(await child.locator("body").innerText()).not.toContain("PRIVATE_RECORD_MARKER");
    expect(
      await child.evaluate(async (url) => {
        try {
          await fetch(url);
          return "sent";
        } catch {
          return "blocked";
        }
      }, `http://127.0.0.1:${address.port}/leak`),
    ).toBe("blocked");
    const frame = page.locator("iframe");
    const previous = await frame.getAttribute("height");
    await page.evaluate(() => {
      const channel = new URL(document.querySelector("iframe")!.src).hash.slice("#channel=".length);
      window.postMessage({ type: "studio.preview.height", channel, height: 9999 }, location.origin);
    });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    expect(await frame.getAttribute("height")).not.toBe("9999");
    expect(previous).toBeTruthy();
    await page.getByRole("button", { name: "Reload preview" }).click();
    await expect(page.frameLocator("iframe").getByText("Synthetic help", { exact: true })).toBeVisible();
    expect(requests).toEqual([]);
    expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(model);
  } finally {
    await new Promise<void>((resolve) => {
      sink.close(() => resolve());
      sink.closeAllConnections();
    });
  }
});

test("keeps unsupported network-bearing documents source-only", async ({ page }) => {
  await writeFile(
    join(root, "help.uidl.json"),
    JSON.stringify({
      ...help(),
      root: { id: "image", type: "Image", props: { src: "https://forbidden.invalid/leak" } },
    }),
  );
  await page.goto(host.url);
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /help\.uidl\.json/ })
    .click();
  await expect(page.getByRole("alert")).toContainText("Preview is source-only");
  await expect(page.locator("iframe")).toHaveCount(0);
});

test("loads at 320px, supports keyboard tabs and browser refresh, and denies missing access", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(host.url);
  await expect(page.getByRole("heading", { name: "Synthetic Request Approval", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("mobile.png"), fullPage: true });
  await page.getByRole("tab", { name: "Definition", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Synthetic Request Approval", exact: true })).toBeVisible();
  await page.goto(`${host.origin}/studio/`);
  await expect(page.getByRole("heading", { name: "Open a local project.", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sources" })).toHaveCount(0);
});
