import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { addCommand, checkCommand, initCommand } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, "../../../.tmp-scaffolding-test");

describe("Kerangka CLI Scaffolding Commands (init and add)", () => {
  beforeAll(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("initCommand scaffolds todo starter document", () => {
    const todoDir = path.join(testDir, "todo-app");
    const ok = initCommand("todo", { output: todoDir, name: "my-todo" });
    expect(ok).toBe(true);

    const docPath = path.join(todoDir, "my-todo.kerangka.json");
    expect(fs.existsSync(docPath)).toBe(true);

    const doc = JSON.parse(fs.readFileSync(docPath, "utf-8"));
    expect(doc.app).toBe("my-todo");
    expect(doc.entities.Task).toBeDefined();

    expect(checkCommand(docPath)).toBe(true);
  });

  it("initCommand scaffolds invoicing starter document", () => {
    const invDir = path.join(testDir, "inv-app");
    const ok = initCommand("invoicing", { output: invDir, name: "my-invoicing" });
    expect(ok).toBe(true);

    const docPath = path.join(invDir, "my-invoicing.kerangka.json");
    expect(fs.existsSync(docPath)).toBe(true);

    const doc = JSON.parse(fs.readFileSync(docPath, "utf-8"));
    expect(doc.app).toBe("my-invoicing");
    expect(doc.entities.Invoice).toBeDefined();

    expect(checkCommand(docPath)).toBe(true);
  });

  it("initCommand scaffolds multi-context workspace", () => {
    const wsDir = path.join(testDir, "ws-app");
    const ok = initCommand("workspace", { output: wsDir, name: "sample-workspace" });
    expect(ok).toBe(true);

    const manifestPath = path.join(wsDir, "kerangka.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(path.join(wsDir, "deploy.kerangka.json"))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, "contexts/core/context.kerangka.json"))).toBe(true);
    expect(fs.existsSync(path.join(wsDir, "contexts/core/aggregates/Item.kerangka.json"))).toBe(true);

    expect(checkCommand(wsDir)).toBe(true);
  });

  it("addCommand scaffolds context, aggregate, action, policy, query, and view", () => {
    const wsDir = path.join(testDir, "add-app");
    expect(initCommand("workspace", { output: wsDir, name: "add-app" })).toBe(true);

    const manifestPath = path.join(wsDir, "kerangka.json");

    // Run addCommand pointing to wsDir
    const prevCwd = process.cwd();
    process.chdir(wsDir);

    try {
      expect(addCommand("context", "billing")).toBe(true);
      expect(fs.existsSync(path.join(wsDir, "contexts/billing/context.kerangka.json"))).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(manifest.contexts).toContain("billing");

      // 2. Add aggregate
      expect(addCommand("aggregate", "Invoice", { context: "billing" })).toBe(true);
      const aggPath = path.join(wsDir, "contexts/billing/aggregates/Invoice.kerangka.json");
      expect(fs.existsSync(aggPath)).toBe(true);
      expect(fs.existsSync(path.join(wsDir, "contexts/billing/tests/Invoice.test.kerangka.json"))).toBe(true);

      // 3. Add action
      expect(addCommand("action", "Invoice.issue", { context: "billing" })).toBe(true);
      const agg = JSON.parse(fs.readFileSync(aggPath, "utf-8"));
      expect(agg.actions.issue).toBeDefined();

      // 4. Add policy
      expect(addCommand("policy", "onItemCreated", { context: "billing", on: "core.ItemCreated", run: "Invoice.create" })).toBe(true);
      const ctx = JSON.parse(fs.readFileSync(path.join(wsDir, "contexts/billing/context.kerangka.json"), "utf-8"));
      expect(ctx.policies.onItemCreated).toBeDefined();

      // 5. Add query
      expect(addCommand("query", "getInvoices", { context: "billing" })).toBe(true);

      // 6. Add view
      expect(addCommand("view", "invoice-list", { context: "billing" })).toBe(true);
      expect(fs.existsSync(path.join(wsDir, "contexts/billing/views/invoice-list.uidl.json"))).toBe(true);

      // 7. Validate that the modified workspace compiles
      expect(checkCommand(wsDir)).toBe(true);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
