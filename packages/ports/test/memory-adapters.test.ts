import { describe, expect, it } from "vitest";
import { MemoryBus, MemoryCache, MemoryStore } from "../src/index.js";

describe("In-Memory Test Adapters", () => {
  it("MemoryStore handles CRUD, filtering, pagination, and rollback", async () => {
    const store = new MemoryStore();

    // Create
    const created = await store.create("Product", { name: "Laptop", price: 1200 }, { tenantId: "t1" });
    expect(created.id).toBeDefined();
    expect(created.name).toBe("Laptop");

    // Get
    const fetched = await store.get("Product", created.id as string, { tenantId: "t1" });
    expect(fetched).toEqual(created);

    // Tenant isolation
    const foreignTenant = await store.get("Product", created.id as string, { tenantId: "t2" });
    expect(foreignTenant).toBeNull();

    // Rollback in transaction
    await expect(
      store.transaction(async (tx) => {
        await tx.create("Product", { name: "Phone", price: 800 });
        throw new Error("Force rollback");
      })
    ).rejects.toThrow("Force rollback");

    const all = await store.find("Product");
    expect(all.total).toBe(1);
    expect(all.items[0]?.name).toBe("Laptop");
  });

  it("MemoryBus publishes events and notifies subscribers", async () => {
    const bus = new MemoryBus();
    const received: unknown[] = [];

    const unsubscribe = bus.subscribe("OrderPlaced", (payload) => {
      received.push(payload);
    });

    await bus.publish("OrderPlaced", { orderId: "123", amount: 250 });
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ orderId: "123", amount: 250 });

    unsubscribe();
    await bus.publish("OrderPlaced", { orderId: "124", amount: 100 });
    expect(received).toHaveLength(1);
  });

  // 1200 inserts: under a full parallel suite this has crossed the default 5 s, failing a
  // run that tests nothing about time. The bound is about load, not about the store.
  it("pushes compound predicates and multi-key sort without crossing tenants", async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 1200; i += 1) {
      await store.create(
        "Invoice",
        { id: `inv-${i}`, status: i % 2 === 0 ? "sent" : "draft", priority: i % 3 },
        { tenantId: i % 2 === 0 ? "tenant-a" : "tenant-b" },
      );
    }

    const result = await store.find("Invoice", undefined, {
      tenantId: "tenant-a",
      where: ["and", ["==", ["get", "status"], "sent"], [">", ["get", "priority"], 0]],
      sort: { priority: "desc", id: "asc" },
      limit: 20,
      offset: 0,
    });

    expect(result.total).toBe(400);
    expect(result.items).toHaveLength(20);
    expect(result.items.every((item) => item.tenantId === "tenant-a")).toBe(true);
    expect(result.items.every((item) => item.status === "sent" && Number(item.priority) > 0)).toBe(true);
  }, 20_000);

  it("MemoryCache sets, gets, deletes, and invalidates patterns", async () => {
    const cache = new MemoryCache();

    await cache.set("user:1", { name: "Alice" });
    await cache.set("user:2", { name: "Bob" });
    await cache.set("session:abc", { token: "secret" });

    expect(await cache.get("user:1")).toEqual({ name: "Alice" });

    await cache.invalidatePattern("user:*");
    expect(await cache.get("user:1")).toBeNull();
    expect(await cache.get("user:2")).toBeNull();
    expect(await cache.get("session:abc")).toEqual({ token: "secret" });
  });
});
