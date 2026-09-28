/**
 * Reusable BusPort Certification Test Kit
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { BusPort } from "../bus.js";

export function createBusTestKit(
  adapterName: string,
  factory: () => Promise<BusPort> | BusPort
): void {
  describe(`BusPort Certification Test Kit: ${adapterName}`, () => {
    it("publishes to and receives from exact topic subscription", async () => {
      const bus = await factory();
      const received: unknown[] = [];

      const unsub = bus.subscribe("OrderPlaced", (payload) => {
        received.push(payload);
      });

      await bus.publish("OrderPlaced", { orderId: "ord-1" });
      expect(received).toHaveLength(1);
      expect((received[0] as { orderId: string }).orderId).toBe("ord-1");

      unsub();
    });

    it("supports wildcard topic subscriptions (e.g. billing:*)", async () => {
      const bus = await factory();
      const events: string[] = [];

      const unsub = bus.subscribe("billing:*", (_payload, meta) => {
        if (meta?.source) events.push(meta.source);
      });

      await bus.publish("billing:InvoiceIssued", {}, { source: "billing:InvoiceIssued" });
      await bus.publish("billing:PaymentReceived", {}, { source: "billing:PaymentReceived" });
      await bus.publish("shipping:ItemShipped", {}, { source: "shipping:ItemShipped" });

      expect(events).toContain("billing:InvoiceIssued");
      expect(events).toContain("billing:PaymentReceived");
      expect(events).not.toContain("shipping:ItemShipped");

      unsub();
    });

    it("stops delivering events after unsubscribe", async () => {
      const bus = await factory();
      let count = 0;

      const unsub = bus.subscribe("Ping", () => {
        count++;
      });

      await bus.publish("Ping", {});
      expect(count).toBe(1);

      unsub();
      await bus.publish("Ping", {});
      expect(count).toBe(1);
    });

    it("delivers events to multiple concurrent subscribers", async () => {
      const bus = await factory();
      let sub1 = false;
      let sub2 = false;

      const unsub1 = bus.subscribe("Broadcast", () => { sub1 = true; });
      const unsub2 = bus.subscribe("Broadcast", () => { sub2 = true; });

      await bus.publish("Broadcast", {});
      expect(sub1).toBe(true);
      expect(sub2).toBe(true);

      unsub1();
      unsub2();
    });
  });
}
