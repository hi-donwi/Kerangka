import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Engine Timers, Schedules, and Temporal Semantics", () => {
  const baseTime = "2026-09-28T10:00:00.000Z";

  it("emits timer effect when entering a state with timed transition and cancel-timer when leaving", () => {
    const ir = {
      kerangka: "0.1",
      app: "timer-test",
      entities: {
        Ticket: {
          fields: {
            id: "string!",
            status: "enum(open, in_progress, resolved) = open",
          },
          workflow: {
            field: "status",
            transitions: {
              start: {
                from: "open",
                to: "in_progress",
              },
              autoResolve: {
                from: "in_progress",
                to: "resolved",
                after: "P3D",
              },
              resolve: {
                from: "in_progress",
                to: "resolved",
              },
            },
          },
        },
      },
    };

    const engine = new Engine(ir);

    // 1. Transition 'open' -> 'in_progress':
    // Entering 'in_progress' which has outgoing timed transition 'autoResolve' with after: 'P3D'
    const planEnter = engine.plan("Ticket", "start", { id: "tick-1", status: "open" }, {}, undefined, {
      now: baseTime,
    });

    expect(planEnter.ok).toBe(true);
    expect(planEnter.effects).toBeDefined();

    const timerEffect = planEnter.effects?.find((e) => e.type === "timer");
    expect(timerEffect).toBeDefined();
    if (timerEffect && timerEffect.type === "timer") {
      expect(timerEffect.action).toBe("Ticket.autoResolve");
      expect(timerEffect.target).toBe("tick-1");
      expect(timerEffect.at).toBe("2026-10-01T10:00:00.000Z"); // +3 days
    }

    // 2. Transition 'in_progress' -> 'resolved':
    // Leaving 'in_progress' should emit cancel-timer effect for 'Ticket.autoResolve'
    const planLeave = engine.plan("Ticket", "resolve", { id: "tick-1", status: "in_progress" }, {}, undefined, {
      now: "2026-09-29T10:00:00.000Z",
    });

    expect(planLeave.ok).toBe(true);
    const cancelEffect = planLeave.effects?.find((e) => e.type === "cancel-timer");
    expect(cancelEffect).toBeDefined();
    if (cancelEffect && cancelEffect.type === "cancel-timer") {
      expect(cancelEffect.action).toBe("Ticket.autoResolve");
      expect(cancelEffect.target).toBe("tick-1");
    }
  });

  it("handles leave-request.kerangka.json SLA task timer and cancellation", () => {
    const rawJson = readFileSync(
      resolve(process.cwd(), "examples/leave-request.kerangka.json"),
      "utf8"
    );
    const ir = JSON.parse(rawJson);
    const engine = new Engine(ir);

    const record = {
      id: "leave-101",
      employeeId: "emp-1",
      days: 3,
      status: "draft",
      startDate: "2026-10-01",
      endDate: "2026-10-04",
      assignedApproverRole: "department-manager",
    };

    // Submitting leave request enters 'submitted' which has reviewLeave task with due: 'P3D', onOverdue: 'escalate'
    const submitPlan = engine.plan("LeaveRequest", "submit", record, {}, { roles: ["employee"] }, { now: baseTime });
    expect(submitPlan.ok).toBe(true);

    const timerEffect = submitPlan.effects?.find((e) => e.type === "timer");
    expect(timerEffect).toBeDefined();
    if (timerEffect && timerEffect.type === "timer") {
      expect(timerEffect.action).toBe("LeaveRequest.escalate");
      expect(timerEffect.target).toBe("leave-101");
      expect(timerEffect.at).toBe("2026-10-01T10:00:00.000Z");
    }

    // Approving the submitted request leaves 'submitted', which cancels the escalation timer
    const submittedRecord = {
      ...record,
      status: "submitted",
    };

    const approvePlan = engine.plan(
      "LeaveRequest",
      "approve",
      submittedRecord,
      {},
      { roles: ["department-manager"] },
      { now: "2026-09-29T12:00:00.000Z" }
    );
    expect(approvePlan.ok).toBe(true);

    const cancelEffect = approvePlan.effects?.find((e) => e.type === "cancel-timer");
    expect(cancelEffect).toBeDefined();
    if (cancelEffect && cancelEffect.type === "cancel-timer") {
      expect(cancelEffect.action).toBe("LeaveRequest.escalate");
      expect(cancelEffect.target).toBe("leave-101");
    }
  });

  it("Engine.schedules returns active task timers, transition timers, and cron schedules", () => {
    const ir = {
      kerangka: "0.1",
      app: "schedules-test",
      schedules: {
        nightlyCleanup: {
          cron: "0 2 * * *",
          run: "System.cleanup",
        },
      },
      entities: {
        Order: {
          fields: {
            id: "string!",
            status: "enum(pending, paid, cancelled) = pending",
          },
          workflow: {
            field: "status",
            tasks: {
              paymentSla: {
                state: "pending",
                due: "PT2H",
                onOverdue: "cancel",
              },
            },
            transitions: {
              cancel: {
                from: "pending",
                to: "cancelled",
              },
            },
          },
        },
      },
    };

    const engine = new Engine(ir);
    const triggers = engine.schedules("Order", { id: "ord-99", status: "pending" }, baseTime);

    expect(triggers.length).toBeGreaterThanOrEqual(2);

    const timerTrigger = triggers.find((t) => t.type === "timer");
    expect(timerTrigger).toBeDefined();
    expect(timerTrigger?.target).toBe("Order.cancel");
    expect(timerTrigger?.triggerAt).toBe("2026-09-28T12:00:00.000Z"); // +2 hours

    const cronTrigger = triggers.find((t) => t.type === "cron");
    expect(cronTrigger).toBeDefined();
    expect(cronTrigger?.target).toBe("System.cleanup");
  });
});
