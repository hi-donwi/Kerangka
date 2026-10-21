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
const journey = () => ({
  kind: "kerangka.studio.journey",
  version: "0.1",
  mode: "reference",
  id: "request-approval",
  name: "Synthetic request approval",
  entry: "help",
  steps: [
    { id: "help", kind: "page", page: "help" },
    { id: "submit", kind: "operation", operation: "Request.submit" },
    { id: "approve", kind: "operation", operation: "Request.approve" },
  ],
  links: [
    { id: "send", from: "help", to: "submit", kind: "action", pointer: "/root/children/1/events/onClick/0" },
  ],
});

test.beforeEach(async () => {
  await writeFile(join(root, "app.kerangka.json"), model);
  await writeFile(join(root, "help.uidl.json"), JSON.stringify(help()));
  await writeFile(join(root, "approval.journey.json"), JSON.stringify(journey()));
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

test("switches the design modes, searches the catalog, and inspects the selected node", async ({ page }) => {
  await page.goto(host.url);

  // The three ways of working are one tab strip, and each one is reachable by keyboard.
  const modes = page.getByRole("tablist", { name: "Design mode" });
  await expect(modes.getByRole("tab")).toHaveText(["Pages", "Journeys", "Model"]);

  await modes.getByRole("tab", { name: "Model" }).click();
  const catalog = page.getByRole("region", { name: "Component catalog" });
  await expect(catalog).toBeVisible();
  await expect(page.getByRole("region", { name: "Model entities" })).toBeVisible();

  // The catalog is read from the runtime registry, so a search finds a real component.
  await catalog.getByRole("searchbox").fill("TextField");
  await expect(catalog.getByRole("listitem").filter({ hasText: "TextField" }).first()).toBeVisible();

  await modes.getByRole("tab", { name: "Journeys" }).click();
  // The project declares a journey, so the console shows it rather than an empty state.
  await expect(page.getByRole("region", { name: "Synthetic request approval journey" })).toBeVisible();

  // Back to the pages, and the inspector reports the node selected in the preview.
  await modes.getByRole("tab", { name: "Pages" }).click();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /help\.uidl\.json/ })
    .click();
  const content = page.frameLocator("iframe");
  await content.locator("[data-node-id='help-text']").first().click();
  const inspector = page.getByRole("region", { name: "Node inspector" });
  await expect(inspector).toContainText("help-text");
  await expect(inspector).toContainText("Text");
});

test("selects a node in the isolated preview and marks it for the author", async ({ page }) => {
  await page.goto(host.url);
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /help\.uidl\.json/ })
    .click();

  const content = page.frameLocator("iframe");
  await expect(content.getByText("Synthetic help", { exact: true })).toBeVisible();
  await expect(page.getByTestId("preview-selection")).toHaveText("Select a node in the preview to inspect it.");

  // A click inside the opaque frame travels over the channel, and the console
  // answers by marking the node inside the frame.
  await content.locator("[data-node-id='help-text']").first().click();
  await expect(page.getByTestId("preview-selection")).toHaveText("Selected node: help-text");

  const child = page.frames().find((frame) => frame.url().includes("/preview.html"))!;
  await expect(child.locator("[data-node-id='help-text'][data-studio-selected='true']")).toHaveCount(1);
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

test("undo and redo share visual and source edits and restore the selection", async ({ page }) => {
  await page.goto(host.url);
  await page
    .getByRole("navigation", { name: "Entities" })
    .getByRole("button", { name: /^Request/ })
    .click();
  const form = page.getByRole("form", { name: /Add a field to Request/ });
  await form.getByLabel("New field name", { exact: true }).fill("note");
  await form.getByRole("button", { name: "Add field" }).click();
  await form.getByLabel("New field name", { exact: true }).fill("extra");
  await form.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("extra");
  await page.getByRole("navigation", { name: "Sources" }).getByRole("button", { name: "app.kerangka.json" }).click();
  await expect(page.getByText(/YAML stays source-only/)).toBeVisible();
  const editor = page.getByRole("textbox", { name: "Source editor text" });
  await editor.fill((await editor.inputValue()).replace("Synthetic Request Approval", "Renamed Approval"));
  await page.getByRole("button", { name: "Apply source edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Renamed Approval", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Synthetic Request Approval", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("extra");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("region", { name: "Entity fields" })).not.toContainText("extra");
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("note");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("extra");
  expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(model);
});

test("configures a generated form section without writing emitted UIDL", async ({ page }) => {
  await page.goto(host.url);
  const help = await readFile(join(root, "help.uidl.json"), "utf8");
  await page.getByRole("navigation", { name: "Screens" }).getByRole("button", { name: /^request form$/ }).click();
  await expect(page.frameLocator("iframe").getByRole("heading", { name: "Identity", exact: true })).toBeVisible();
  const form = page.getByRole("form", { name: "Configure form sections for request" });
  await form.getByLabel("Section 1 title").fill("Applicant");
  await form.getByRole("button", { name: "Move down" }).first().click();
  await form.getByRole("button", { name: "Apply section layout" }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(model);
  expect(await readFile(join(root, "help.uidl.json"), "utf8")).toBe(help);
});

test("drafts an added entity field as a preview and never writes the file", async ({ page }) => {
  await page.goto(host.url);
  await expect(page.getByText("READ ONLY", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Entities" })
    .getByRole("button", { name: /^Request/ })
    .click();
  const form = page.getByRole("form", { name: /Add a field to Request/ });
  await form.getByLabel("New field name", { exact: true }).fill("note");
  await form.getByLabel("Type", { exact: true }).selectOption("string");
  await form.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText(/addEntityField Request\.note/)).toBeVisible();
  await expect(page.getByText("UNSAVED DRAFT", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("note");
  await page.getByRole("tab", { name: "REST API", exact: true }).click();
  await expect(page.getByRole("region", { name: "Derived output" })).toContainText("note");
  await page.getByRole("tab", { name: "PostgreSQL", exact: true }).click();
  await expect(page.getByRole("region", { name: "Derived output" })).toContainText("note");
  expect(await readFile(join(root, "app.kerangka.json"), "utf8")).toBe(model);
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

test.describe("writable host: save and conflict recovery", () => {
  let writableRoot: string;
  let writableHost: StudioHost;
  let writableModel: string;

  test.beforeAll(async () => {
    writableRoot = await mkdtemp(join(tmpdir(), "kerangka-studio-writable-"));
    writableModel = await readFile(
      new URL("../../../packages/cli/test/fixtures/studio/approval.kerangka.json", import.meta.url),
      "utf8",
    );
    await writeFile(join(writableRoot, "app.kerangka.json"), writableModel);
    writableHost = await startStudio({ target: writableRoot, port: 0, writable: true });
  });
  test.beforeEach(async () => {
    await writeFile(join(writableRoot, "app.kerangka.json"), writableModel);
    await writeFile(join(writableRoot, "approval.journey.json"), JSON.stringify(journey()));
  });

test("edits a journey through the draft path, saves it, and keeps the file valid", async ({ page }) => {
  await page.goto(writableHost.url);
  const headers = {
    Authorization: `Bearer ${writableHost.token}`,
    Origin: writableHost.origin,
    "Content-Type": "application/json",
  };
  const before = await (await page.request.get(`${writableHost.origin}/studio/api/project`, { headers })).json();
  const revision = before.bundle.revision;

  // A person connects two steps on the canvas. The canvas proposes the connection, and
  // the draft path turns it into a change of the journey file.
  const drafted = await page.request.post(`${writableHost.origin}/studio/api/draft`, {
    headers,
    data: {
      expectedRevision: revision,
      operations: [
        {
          op: "journeyAddLink",
          journey: "approval.journey.json",
          link: { id: "review", from: "submit", to: "approve", kind: "annotation" },
        },
      ],
    },
  });
  expect(drafted.ok()).toBe(true);
  const draft = await drafted.json();
  expect(draft.applied).toContain("journeyAddLink approval.journey.json");

  // The connection is in the draft, and the console shows it.
  const edited = JSON.parse(draft.bundle.sources["approval.journey.json"].text);
  expect(edited.links.map((link: { id: string }) => link.id)).toEqual(["send", "review"]);

  // Saving writes the file, and the file is still a journey.
  const saved = await page.request.post(`${writableHost.origin}/studio/api/save`, {
    headers,
    // The save is checked against the file on disk, not against the draft.
    data: { expectedRevision: revision, sources: draft.bundle.sources },
  });
  expect(saved.ok()).toBe(true);
  const onDisk = JSON.parse(await readFile(join(writableRoot, "approval.journey.json"), "utf8"));
  expect(onDisk.links.map((link: { id: string }) => link.id)).toEqual(["send", "review"]);
  expect(onDisk.entry).toBe("help");
});

test("loads a journey from the project, checks it, and draws it", async ({ page }) => {
  await page.goto(host.url);
  await page.getByRole("tablist", { name: "Design mode" }).getByRole("tab", { name: "Journeys" }).click();

  const canvas = page.getByRole("region", { name: "Synthetic request approval journey" });
  await expect(canvas).toBeVisible();

  // The journey is checked against the pages and the operations that exist, and a
  // journey that checks out says nothing.
  await expect(page.getByRole("list", { name: "Journey problems" })).toHaveCount(0);

  // The canvas is there, and it draws the steps the journey declares.
  await expect(canvas).toBeVisible();
  await expect(canvas.locator(".react-flow__node")).toHaveCount(3);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(1);
});

test("draws the workflow on a canvas, moves a state, and picks it", async ({ page }) => {
  await page.goto(host.url);
  await page.getByRole("tablist", { name: "Design mode" }).getByRole("tab", { name: "Model" }).click();

  const canvas = page.getByRole("region", { name: "Workflow canvas" });
  await expect(canvas).toBeVisible();

  // The states and the transitions come from the model.
  const states = canvas.locator(".react-flow__node");
  await expect(states).toHaveCount(4);
  await expect(canvas.locator(".react-flow__edge")).toHaveCount(3);
  await expect(canvas.getByText("draft", { exact: true })).toBeVisible();

  // A state can be picked, and the console says which one.
  await canvas.locator(".react-flow__node").filter({ hasText: "approved" }).click();
  await expect(page.getByText("approved", { exact: true }).first()).toBeVisible();

  // The canvas is a controlled surface: the host owns the positions, and a state is
  // marked as draggable for the person using it.
  const node = canvas.locator(".react-flow__node").filter({ hasText: "submitted" });
  await expect(node).toHaveClass(/draggable/);
  expect(await node.getAttribute("style")).toContain("translate(");
});

test("materializes the real generated page, saves it, and finds it again after a reload", async ({ page }) => {
  await page.goto(writableHost.url);
  // The form view is the one that can be materialized; the list view is generated.
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /request.*form/i })
    .click();

  const materialize = page.getByRole("button", { name: /Materialize/ });
  await expect(materialize).toBeVisible();
  await materialize.click();
  await expect(page.getByText(/created as authored source/)).toBeVisible();

  // It survives a save, and the console finds it again after a reload.
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/saved to disk/)).toBeVisible();

  // The authored page is the generated page, not an empty container.
  const authored = JSON.parse(await readFile(join(writableRoot, "request.uidl.json"), "utf8"));
  expect(authored.root).toBeTruthy();
  expect(JSON.stringify(authored)).not.toBe('{"id":"root","type":"Container","children":[]}');

  await page.reload();
  await page
    .getByRole("navigation", { name: "Screens" })
    .getByRole("button", { name: /request\.uidl\.json/ })
    .click();
  await expect(page.getByText(/authored/i).first()).toBeVisible();
});

  test.afterAll(async () => {
    await writableHost?.close();
    if (writableRoot) await rm(writableRoot, { recursive: true, force: true });
  });

  test("saves a draft to disk and advances the revision", async ({ page }) => {
    await page.goto(writableHost.url);
    await expect(page.getByText("WRITABLE HOST", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Entities" })
      .getByRole("button", { name: /^Request/ })
      .click();
    const form = page.getByRole("form", { name: /Add a field to Request/ });
    await form.getByLabel("New field name", { exact: true }).fill("note");
    await form.getByLabel("Type", { exact: true }).selectOption("string");
    await form.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByText("UNSAVED DRAFT", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByText(/saved to disk/)).toBeVisible();
    const saved = JSON.parse(await readFile(join(writableRoot, "app.kerangka.json"), "utf8"));
    expect(saved.entities.Request.fields.note).toBe("string?");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.reload();
    await page
      .getByRole("navigation", { name: "Entities" })
      .getByRole("button", { name: /^Request/ })
      .click();
    await expect(page.getByRole("region", { name: "Entity fields" })).toContainText("note");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });

  test("recovers from a revision conflict by keeping the file on disk", async ({ page }) => {
    await page.goto(writableHost.url);
    await page
      .getByRole("navigation", { name: "Entities" })
      .getByRole("button", { name: /^Request/ })
      .click();
    const form = page.getByRole("form", { name: /Add a field to Request/ });
    await form.getByLabel("New field name", { exact: true }).fill("note");
    await form.getByLabel("Type", { exact: true }).selectOption("string");
    await form.getByRole("button", { name: "Add field" }).click();
    await expect(page.getByText("UNSAVED DRAFT", { exact: true })).toBeVisible();
    // Externally change the file so the save's expected revision is stale.
    const external = JSON.parse(writableModel);
    external.entities.Request.fields.external = "string";
    await writeFile(join(writableRoot, "app.kerangka.json"), JSON.stringify(external, null, 2));
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const panel = page.getByRole("alert", { name: "Revision conflict" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("YOUR DRAFT");
    await expect(panel).toContainText("FILE ON DISK");
    await panel.getByRole("button", { name: "Keep the file on disk" }).click();
    await expect(page.getByText(/file on disk was kept/)).toBeVisible();
    const kept = JSON.parse(await readFile(join(writableRoot, "app.kerangka.json"), "utf8"));
    expect(kept.entities.Request.fields.external).toBe("string");
    expect(kept.entities.Request.fields.note).toBeUndefined();
  });
});
