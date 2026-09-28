import { describe, expect, it } from "vitest";
import {
  DatabaseOutboxBus,
  MemoryStore,
} from "../src/index.js";
import { createBusTestKit } from "../src/test-kits/index.js";

// Certify DatabaseOutboxBus with standard BusPort test kit
createBusTestKit("DatabaseOutboxBus (immediate)", () => {
  const store = new MemoryStore();
  return new DatabaseOutboxBus({ store, immediateDispatch: true });
});

describe("DatabaseOutboxBus - Polling and Transactional Outbox Semantics", () => {
  it("buffers messages in outbox when immediateDispatch is false and dispatches on poll", async () => {
    const store = new MemoryStore();
    const bus = new DatabaseOutboxBus({ store, immediateDispatch: false });

    const received: string[] = [];
    bus.subscribe("order:Created", (payload) => {
      received.push((payload as { orderId: string }).orderId);
    });

    // 1. Publish should not immediately deliver when immediateDispatch is false
    await bus.publish("order:Created", { orderId: "ORD-999" });
    expect(received).toHaveLength(0);

    // 2. Pending outbox in store must have the message
    const pendingBefore = await store.fetchPendingOutbox(10);
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0]?.eventType).toBe("order:Created");

    // 3. pollAndDispatch delivers to subscriber and marks dispatched
    const dispatchedCount = await bus.pollAndDispatch();
    expect(dispatchedCount).toBe(1);
    expect(received).toEqual(["ORD-999"]);

    // 4. Pending outbox in store must now be empty
    const pendingAfter = await store.fetchPendingOutbox(10);
    expect(pendingAfter).toHaveLength(0);
  });
});
