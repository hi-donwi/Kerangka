import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compile } from "@kerangka/compiler";
import { CloudEvent, DecisionTableDef, loadEngine } from "../src/index.js";

describe("Phase 2 Pure TypeScript Engine Core API", () => {
  const examplesDir = resolve(__dirname, "../../../examples");
  const invoiceRaw = readFileSync(resolve(examplesDir, "invoicing.kerangka.json"), "utf8");
  const invoiceKir = compile(invoiceRaw);
  const invoiceEngine = loadEngine(invoiceKir);

  // ---------------------------------------------------------------------------
  // 1. can(...)
  // ---------------------------------------------------------------------------
  describe("can()", () => {
    const draftInvoice = {
      id: "inv-101",
      number: "INV-2026-101",
      customer: "cust-01",
      status: "draft",
      lines: [{ description: "Consulting", qty: 2, unitPrice: 200 }],
      total: 400,
    };

    it("allows transition when state, roles, and guards are satisfied", () => {
      const res = invoiceEngine.can("Invoice.send", draftInvoice, { roles: ["billing"] });
      expect(res.allowed).toBe(true);
    });

    it("denies transition with PERMISSION_DENIED when actor lacks role", () => {
      const res = invoiceEngine.can("Invoice.send", draftInvoice, { roles: ["customer-support"] });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe("PERMISSION_DENIED");
      expect(res.reason).toContain("role");
    });

    it("denies transition with INVALID_STATE_TRANSITION when current status is ineligible", () => {
      const sentInvoice = { ...draftInvoice, status: "sent" };
      const res = invoiceEngine.can("Invoice.send", sentInvoice, { roles: ["billing"] });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe("INVALID_STATE_TRANSITION");
    });

    it("denies transition with GUARD_FAILED when invoice has no lines", () => {
      const emptyInvoice = { ...draftInvoice, lines: [] };
      const res = invoiceEngine.can("Invoice.send", emptyInvoice, { roles: ["billing"] });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe("GUARD_FAILED");
    });

    it("returns UNKNOWN_OPERATION for non-existent actions or transitions", () => {
      const res = invoiceEngine.can("Invoice.nonExistent", draftInvoice);
      expect(res.allowed).toBe(false);
      expect(res.code).toBe("UNKNOWN_OPERATION");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. available(...)
  // ---------------------------------------------------------------------------
  describe("available()", () => {
    it("discovers all available actions and transitions for an actor on a record", () => {
      const draftInvoice = {
        id: "inv-102",
        status: "draft",
        lines: [{ description: "Design", qty: 1, unitPrice: 300 }],
        total: 300,
      };

      const ops = invoiceEngine.available("Invoice", draftInvoice, { roles: ["billing"] });
      expect(ops.length).toBeGreaterThan(0);

      const sendOp = ops.find((op) => op.name === "send");
      expect(sendOp).toBeDefined();
      expect(sendOp?.type).toBe("transition");
      expect(sendOp?.targetStatus).toBe("sent");

      // An unprivileged actor should have no send transition
      const guestOps = invoiceEngine.available("Invoice", draftInvoice, { roles: ["guest"] });
      expect(guestOps.find((op) => op.name === "send")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. plan(...)
  // ---------------------------------------------------------------------------
  describe("plan()", () => {
    const validInvoice = {
      id: "inv-103",
      number: "INV-2026-103",
      customer: "cust-02",
      status: "draft",
      lines: [{ description: "Hosting", qty: 1, unitPrice: 150 }],
      total: 150,
    };

    it("performs dry-run calculation and computes patch diff without side-effects", () => {
      const plan = invoiceEngine.plan("Invoice.send", validInvoice, {}, { roles: ["billing"] });

      expect(plan.ok).toBe(true);
      expect(plan.patch).toBeDefined();
      expect(plan.patch?.status).toBe("sent");
      expect(plan.projectedRecord?.status).toBe("sent");

      // Verified events and effects produced in plan
      expect(plan.events?.length).toBeGreaterThan(0);
      expect(plan.events?.[0]?.type).toBe("InvoiceSent");
      expect(plan.effects?.some((e) => e.type === "emit")).toBe(true);
      expect(plan.effects?.some((e) => e.type === "persist")).toBe(true);
    });

    it("returns error without patch if pre-conditions fail", () => {
      const plan = invoiceEngine.plan("Invoice.send", validInvoice, {}, { roles: ["unauthorized"] });
      expect(plan.ok).toBe(false);
      expect(plan.code).toBe("PERMISSION_DENIED");
      expect(plan.patch).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. run(...) with ExecutionTrace & CloudEvents 1.0
  // ---------------------------------------------------------------------------
  describe("run()", () => {
    const validInvoice = {
      id: "inv-104",
      number: "INV-2026-104",
      customer: "cust-03",
      status: "draft",
      lines: [{ description: "Auditing", qty: 4, unitPrice: 250 }],
      total: 1000,
    };

    it("emits events in compliant CloudEvents 1.0 envelope", () => {
      const result = invoiceEngine.run(
        "Invoice.send",
        validInvoice,
        {},
        { roles: ["billing"], tenantId: "tenant-acme" },
        { now: "2026-09-28T18:00:00Z" }
      );

      expect(result.ok).toBe(true);
      expect(result.record?.status).toBe("sent");

      expect(result.events?.length).toBe(1);
      const ce = result.events![0] as CloudEvent;

      expect(ce.specversion).toBe("1.0");
      expect(ce.id).toMatch(/^evt_/);
      expect(ce.type).toBe("InvoiceSent");
      expect(ce.name).toBe("InvoiceSent");
      expect(ce.source).toContain("Invoice");
      expect(ce.time).toBe("2026-09-28T18:00:00.000Z");
      expect(ce.datacontenttype).toBe("application/json");
      expect(ce.subject).toBe("inv-104");
      expect(ce.tenantid).toBe("tenant-acme");
    });

    it("captures execution trace with detailed steps when trace: true", () => {
      const result = invoiceEngine.run(
        "Invoice.send",
        validInvoice,
        {},
        { roles: ["billing"] },
        { trace: true }
      );

      expect(result.ok).toBe(true);
      expect(result.trace).toBeDefined();

      const trace = result.trace!;
      expect(trace.operation).toBe("Invoice.send");
      expect(trace.entity).toBe("Invoice");
      expect(trace.startedAt).toBeDefined();
      expect(trace.endedAt).toBeDefined();
      expect(trace.durationMs).toBeGreaterThanOrEqual(0);

      const stepNames = trace.steps.map((s) => s.step);
      expect(stepNames).toContain("role_check");
      expect(stepNames).toContain("mutation");
      expect(stepNames).toContain("invariants");
      expect(stepNames).toContain("effects");
    });
  });

  // ---------------------------------------------------------------------------
  // 5. readFilter(...)
  // ---------------------------------------------------------------------------
  describe("readFilter()", () => {
    const rawInv = readFileSync(resolve(examplesDir, "inventory.kerangka.json"), "utf8");
    const invKir = compile(rawInv);
    const invEngine = loadEngine(invKir);

    it("automatically injects tenantId equality filter when tenantId is in actor context", () => {
      const filter = invEngine.readFilter("StockItem", { tenantId: "tenant-xyz" });
      expect(filter).toEqual(["==", ["get", "tenantId"], "tenant-xyz"]);
    });

    it("returns null when no tenant or soft delete filter applies", () => {
      const filter = invEngine.readFilter("StockItem", {});
      expect(filter).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 6. queryPlan(...)
  // ---------------------------------------------------------------------------
  describe("queryPlan()", () => {
    it("compiles query plan with pagination, ordering, and applied read filters", () => {
      const appWithQuery = {
        app: "todo",
        entities: {
          Todo: {
            fields: { title: "string!", completed: "bool = false", tenantId: "string!" },
          },
        },
        queries: {
          activeTodos: {
            from: "Todo",
            where: ["==", ["get", "completed"], false],
            orderBy: "title asc",
            limit: 50,
          },
        },
      };

      const todoEngine = loadEngine(appWithQuery);
      const plan = todoEngine.queryPlan("activeTodos", { page: 2, limit: 10 }, { tenantId: "t1" });

      expect(plan.query).toBe("activeTodos");
      expect(plan.entity).toBe("Todo");
      expect(plan.limit).toBe(10);
      expect(plan.offset).toBe(10); // page 2 with limit 10 -> offset 10
      expect(plan.where).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 7. react(...)
  // ---------------------------------------------------------------------------
  describe("react()", () => {
    it("matches domain events to declared policies and produces invocations", () => {
      const appWithPolicy = {
        app: "ordering",
        policies: {
          markOrderPaid: {
            on: "billing:InvoicePaid",
            target: "event.orderId",
            run: "Order.markPaid",
            input: { paidAmount: "event.amount" },
          },
        },
      };

      const engine = loadEngine(appWithPolicy);
      const reaction = engine.react({
        type: "billing:InvoicePaid",
        data: { orderId: "ord-999", amount: 1250 },
      });

      expect(reaction.handled).toBe(true);
      expect(reaction.invocations.length).toBe(1);

      const inv = reaction.invocations[0]!;
      expect(inv.policy).toBe("markOrderPaid");
      expect(inv.action).toBe("Order.markPaid");
      expect(inv.targetId).toBe("ord-999");
      expect(inv.input?.paidAmount).toBe(1250);
    });

    it("supports wildcard event matching in policies", () => {
      const appWithWildcard = {
        app: "audit",
        policies: {
          logAnyBillingEvent: {
            on: "billing:*",
            run: "AuditLog.record",
          },
        },
      };

      const engine = loadEngine(appWithWildcard);
      const res = engine.react({ type: "billing:InvoiceIssued", data: {} });
      expect(res.handled).toBe(true);
      expect(res.invocations[0]?.action).toBe("AuditLog.record");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. decide(...)
  // ---------------------------------------------------------------------------
  describe("decide()", () => {
    const discountTable: DecisionTableDef = {
      name: "discountPolicy",
      hitPolicy: "first",
      inputs: [
        { name: "tier", type: "string" },
        { name: "amount", type: "number" },
      ],
      outputs: [{ name: "discountPct", type: "number" }],
      rules: [
        { inputs: ["platinum", ">= 1000"], outputs: { discountPct: 25 } },
        { inputs: ["platinum", "< 1000"], outputs: { discountPct: 15 } },
        { inputs: ["gold", ">= 500"], outputs: { discountPct: 10 } },
        { inputs: ["gold, silver", "-"], outputs: { discountPct: 5 } },
        { inputs: ["-", "-"], outputs: { discountPct: 0 } },
      ],
    };

    const engine = loadEngine({ decisions: { discountPolicy: discountTable } });

    it("evaluates first match rule with range and comparisons", () => {
      const res1 = engine.decide("discountPolicy", { tier: "platinum", amount: 1500 });
      expect(res1.matched).toBe(true);
      expect(res1.outputs).toEqual({ discountPct: 25 });

      const res2 = engine.decide("discountPolicy", { tier: "gold", amount: 600 });
      expect(res2.matched).toBe(true);
      expect(res2.outputs).toEqual({ discountPct: 10 });

      const res3 = engine.decide("discountPolicy", { tier: "silver", amount: 100 });
      expect(res3.matched).toBe(true);
      expect(res3.outputs).toEqual({ discountPct: 5 });

      const res4 = engine.decide("discountPolicy", { tier: "bronze", amount: 50 });
      expect(res4.matched).toBe(true);
      expect(res4.outputs).toEqual({ discountPct: 0 });
    });

    it("supports unique hit policy and flags overlaps", () => {
      const uniqueTable: DecisionTableDef = {
        name: "statusMap",
        hitPolicy: "unique",
        inputs: [{ name: "code", type: "string" }],
        outputs: [{ name: "label", type: "string" }],
        rules: [
          { inputs: ["A"], outputs: { label: "Active" } },
          { inputs: ["A"], outputs: { label: "Alternate" } },
        ],
      };

      const res = engine.decide(uniqueTable, { code: "A" });
      expect(res.matched).toBe(false);
      expect(res.code).toBe("UNIQUE_VIOLATION");
    });

    it("supports collect hit policy to return multiple matching outputs", () => {
      const collectTable: DecisionTableDef = {
        name: "featureFlags",
        hitPolicy: "collect",
        inputs: [{ name: "role", type: "string" }],
        outputs: [{ name: "feature", type: "string" }],
        rules: [
          { inputs: ["admin"], outputs: { feature: "export_csv" } },
          { inputs: ["admin"], outputs: { feature: "manage_users" } },
          { inputs: ["user"], outputs: { feature: "read_only" } },
        ],
      };

      const res = engine.decide(collectTable, { role: "admin" });
      expect(res.matched).toBe(true);
      expect(Array.isArray(res.outputs)).toBe(true);
      expect((res.outputs as unknown[]).length).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. schedules(...)
  // ---------------------------------------------------------------------------
  describe("schedules()", () => {
    it("evaluates workflow transition timers with relative duration", () => {
      const appWithTimer = {
        app: "billing",
        entities: {
          Invoice: {
            workflow: {
              transitions: {
                escalate: {
                  from: "sent",
                  to: "escalated",
                  timer: { after: "7d" },
                },
              },
            },
          },
        },
      };

      const engine = loadEngine(appWithTimer);
      const baseTime = "2026-09-28T12:00:00Z";
      const triggers = engine.schedules("Invoice", { id: "inv-900", status: "sent" }, baseTime);

      expect(triggers.length).toBe(1);
      const trig = triggers[0]!;
      expect(trig.type).toBe("timer");
      expect(trig.target).toBe("Invoice.escalate");
      // 7 days after 2026-09-28 is 2026-10-05
      expect(trig.triggerAt).toBe("2026-10-05T12:00:00.000Z");
    });
  });
});
