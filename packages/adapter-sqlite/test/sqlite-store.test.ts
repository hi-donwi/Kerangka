import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { createStoreTestKit } from "@kerangka/ports";
import { SqliteStore } from "../src/index.js";

// Reusable standard certification test kit
createStoreTestKit("SqliteStore", () => new SqliteStore());

describe("SQLite Store Adapter (KIR-based)", () => {
  const examplesDir = resolve(__dirname, "../../../examples");

  it("initializes schema and performs CRUD on Todo entity", async () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);

    const store = new SqliteStore({ kir });
    store.initSchema();

    // 1. Create
    const created = await store.create("Todo", {
      id: "todo-1",
      title: "Write documentation",
      completed: false,
      priority: "high",
    });
    expect(created.id).toBe("todo-1");
    expect(created.title).toBe("Write documentation");
    expect(created.completed).toBe(false);

    // 2. Get
    const fetched = await store.get("Todo", "todo-1");
    expect(fetched).toEqual(created);

    // 3. Update
    const updated = await store.update("Todo", "todo-1", {
      completed: true,
    });
    expect(updated.completed).toBe(true);

    // 4. Find
    const list = await store.find("Todo", { priority: "high" });
    expect(list.total).toBe(1);
    expect(list.items[0]?.title).toBe("Write documentation");

    // 5. Delete
    const deleted = await store.delete("Todo", "todo-1");
    expect(deleted).toBe(true);

    const afterDelete = await store.get("Todo", "todo-1");
    expect(afterDelete).toBeNull();
  });

  it("strictly enforces tenant isolation on multitenant Inventory entity", async () => {
    const raw = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const kir = compile(raw);

    const store = new SqliteStore({ kir });
    store.initSchema();

    // Tenant A creates item SKU-1
    await store.create(
      "StockItem",
      {
        sku: "SKU-1",
        name: "Widget A",
        quantity: 100,
        reserved: 10,
        unitCost: 15.5,
      },
      { tenantId: "tenant-alpha" }
    );

    // Tenant B creates item with same SKU-1 (isolated via composite PK)
    await store.create(
      "StockItem",
      {
        sku: "SKU-1",
        name: "Widget B",
        quantity: 50,
        reserved: 5,
        unitCost: 20.0,
      },
      { tenantId: "tenant-beta" }
    );

    // Query Tenant Alpha
    const alphaItem = await store.get("StockItem", "SKU-1", { tenantId: "tenant-alpha" });
    expect(alphaItem).toBeDefined();
    expect(alphaItem?.name).toBe("Widget A");
    expect(alphaItem?.quantity).toBe(100);

    // Query Tenant Beta
    const betaItem = await store.get("StockItem", "SKU-1", { tenantId: "tenant-beta" });
    expect(betaItem).toBeDefined();
    expect(betaItem?.name).toBe("Widget B");
    expect(betaItem?.quantity).toBe(50);

    // List for Tenant Beta only
    const betaList = await store.find("StockItem", {}, { tenantId: "tenant-beta" });
    expect(betaList.total).toBe(1);
    expect(betaList.items[0]?.name).toBe("Widget B");
  });

  it("rolls back failed operations in a transaction", async () => {
    const raw = readFileSync(resolve(examplesDir, "todo.kerangka.json"), "utf8");
    const kir = compile(raw);

    const store = new SqliteStore({ kir });
    store.initSchema();

    await expect(
      store.transaction(async (tx) => {
        await tx.create("Todo", {
          id: "tx-todo-1",
          title: "Rollback candidate",
          completed: false,
          priority: "low",
        });
        // Intentionally throw
        throw new Error("Abort transaction");
      })
    ).rejects.toThrow("Abort transaction");

    const item = await store.get("Todo", "tx-todo-1");
    expect(item).toBeNull();
  });
});
