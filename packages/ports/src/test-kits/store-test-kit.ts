/**
 * Reusable StorePort Certification Test Kit
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutboxMessage, StorePort, TimerEntry, VersionConflictError } from "../store.js";

export interface StoreTestKitOptions {
  cleanup?: (store: StorePort) => Promise<void> | void;
}

export function createStoreTestKit(
  adapterName: string,
  factory: () => Promise<StorePort> | StorePort,
  options: StoreTestKitOptions = {}
): void {
  describe(`StorePort Certification Test Kit: ${adapterName}`, () => {
    let store: StorePort;

    beforeEach(async () => {
      store = await factory();
    });

    afterEach(async () => {
      if (options.cleanup) {
        await options.cleanup(store);
      }
    });

    // -------------------------------------------------------------------------
    // 1. Basic CRUD
    // -------------------------------------------------------------------------
    it("creates, reads, updates, and deletes records", async () => {
      const created = await store.create("Product", {
        name: "Mechanical Keyboard",
        price: 150,
        version: 1,
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("Mechanical Keyboard");

      const fetched = await store.get("Product", created.id as string);
      expect(fetched).toBeDefined();
      expect(fetched?.name).toBe("Mechanical Keyboard");

      const updated = await store.update("Product", created.id as string, {
        price: 175,
      });
      expect(updated.price).toBe(175);

      const deleted = await store.delete("Product", created.id as string);
      expect(deleted).toBe(true);

      const afterDelete = await store.get("Product", created.id as string);
      expect(afterDelete).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Multi-tenancy Scoping
    // -------------------------------------------------------------------------
    it("enforces tenant isolation across get and find operations", async () => {
      const itemT1 = await store.create("Order", { number: "ORD-001" }, { tenantId: "tenant-a" });
      const itemT2 = await store.create("Order", { number: "ORD-002" }, { tenantId: "tenant-b" });

      // get with correct tenant
      const getT1 = await store.get("Order", itemT1.id as string, { tenantId: "tenant-a" });
      expect(getT1).toBeDefined();

      // get with wrong tenant must return null
      const getT1AsT2 = await store.get("Order", itemT1.id as string, { tenantId: "tenant-b" });
      expect(getT1AsT2).toBeNull();

      // find scoped to tenant-a
      const findT1 = await store.find("Order", {}, { tenantId: "tenant-a" });
      expect(findT1.items.some((i) => i.id === itemT1.id)).toBe(true);
      expect(findT1.items.some((i) => i.id === itemT2.id)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // 3. Soft Delete
    // -------------------------------------------------------------------------
    it("supports soft-deletion and hides soft-deleted records by default", async () => {
      const doc = await store.create("Customer", { name: "Acme Corp" });
      const id = doc.id as string;

      const softDeleted = await store.delete("Customer", id, { soft: true });
      expect(softDeleted).toBe(true);

      // Default find must exclude soft-deleted
      const activeOnly = await store.find("Customer", { name: "Acme Corp" });
      expect(activeOnly.items.some((c) => c.id === id)).toBe(false);

      // find with includeSoftDeleted: true must include it
      const withDeleted = await store.find("Customer", { name: "Acme Corp" }, { includeSoftDeleted: true });
      expect(withDeleted.items.some((c) => c.id === id)).toBe(true);
    });

    // -------------------------------------------------------------------------
    // 4. Optimistic Concurrency Version Conflicts
    // -------------------------------------------------------------------------
    it("enforces optimistic concurrency and rejects version mismatches", async () => {
      const item = await store.create("Inventory", { sku: "SKU-99", qty: 100, version: 1 });
      const id = item.id as string;

      // Update with matching expectedVersion succeeds
      const updated = await store.update("Inventory", id, { qty: 90 }, { expectedVersion: 1 });
      expect(updated.qty).toBe(90);
      expect(updated.version).toBe(2);

      // Update with stale expectedVersion must throw VersionConflictError
      await expect(
        store.update("Inventory", id, { qty: 80 }, { expectedVersion: 1 })
      ).rejects.toThrow(VersionConflictError);
    });

    // -------------------------------------------------------------------------
    // 5. Pagination & Total Count
    // -------------------------------------------------------------------------
    it("supports pagination with offset, limit, and total count", async () => {
      for (let i = 1; i <= 5; i++) {
        await store.create("LogEntry", { seq: i, message: `Log #${i}` });
      }

      const page1 = await store.find("LogEntry", {}, { limit: 2, offset: 0, sort: { seq: "asc" } });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await store.find("LogEntry", {}, { limit: 2, offset: 2, sort: { seq: "asc" } });
      expect(page2.items).toHaveLength(2);
    });

    // -------------------------------------------------------------------------
    // 6. Transaction Rollback
    // -------------------------------------------------------------------------
    it("rolls back all changes when a transaction throws", async () => {
      await expect(
        store.transaction(async (tx) => {
          await tx.create("Account", { name: "Checking", balance: 500 });
          throw new Error("Abort transaction");
        })
      ).rejects.toThrow("Abort transaction");

      const check = await store.find("Account", { name: "Checking" });
      expect(check.items).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // 7. Transactional Outbox (ADR-0023 / PLAN.md §8.1)
    // -------------------------------------------------------------------------
    it("enqueues, fetches pending, and marks dispatched outbox messages", async () => {
      const msg: OutboxMessage = {
        id: `outbox-${Date.now()}`,
        eventType: "com.kerangka.billing.InvoicePaid",
        payload: { invoiceId: "inv-01", amount: 500 },
        aggregateId: "inv-01",
        aggregateType: "Invoice",
        tenantId: "tenant-1",
      };

      await store.enqueueOutbox(msg);

      const pending = await store.fetchPendingOutbox(10);
      expect(pending.some((m) => m.id === msg.id)).toBe(true);

      await store.markOutboxDispatched(msg.id);

      const afterDispatch = await store.fetchPendingOutbox(10);
      expect(afterDispatch.some((m) => m.id === msg.id)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // 8. Database Timer Table (ADR-0015 / PLAN.md §8.1)
    // -------------------------------------------------------------------------
    it("enqueues, fetches due timers, and marks dispatched timers", async () => {
      const pastTimer: TimerEntry = {
        id: `timer-past-${Date.now()}`,
        target: "Invoice.escalate",
        payload: { invoiceId: "inv-02" },
        triggerAt: "2020-01-01T00:00:00.000Z",
      };

      const futureTimer: TimerEntry = {
        id: `timer-future-${Date.now()}`,
        target: "Invoice.remind",
        payload: { invoiceId: "inv-03" },
        triggerAt: "2099-01-01T00:00:00.000Z",
      };

      await store.enqueueTimer(pastTimer);
      await store.enqueueTimer(futureTimer);

      const now = "2026-09-28T12:00:00.000Z";
      const due = await store.fetchDueTimers(now, 10);

      expect(due.some((t) => t.id === pastTimer.id)).toBe(true);
      expect(due.some((t) => t.id === futureTimer.id)).toBe(false);

      await store.markTimerDispatched(pastTimer.id);

      const dueAfter = await store.fetchDueTimers(now, 10);
      expect(dueAfter.some((t) => t.id === pastTimer.id)).toBe(false);
    });
  });
}
