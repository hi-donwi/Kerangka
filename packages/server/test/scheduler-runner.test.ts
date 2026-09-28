import { describe, expect, it } from "vitest";
import { KerangkaServer } from "../src/server.js";
import { SchedulerRunner } from "../src/scheduler-runner.js";
import { MemoryScheduler, MemoryStore } from "@kerangka/ports";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("SchedulerRunner and Server Timer Execution", () => {
  it("polls and executes due transition timers as system actor", async () => {
    const rawJson = readFileSync(
      resolve(process.cwd(), "examples/leave-request.kerangka.json"),
      "utf8"
    );
    const kir = JSON.parse(rawJson);
    const store = new MemoryStore();
    const scheduler = new MemoryScheduler();

    const server = new KerangkaServer(kir, {
      store,
      scheduler,
      quiet: true,
    });

    // 1. Seed a leave request in 'submitted' state
    await store.create("LeaveRequest", {
      id: "leave-88",
      employeeId: "emp-88",
      days: 2,
      status: "submitted",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      assignedApproverRole: "team-lead",
    });

    // 2. Schedule a timer for LeaveRequest.escalate due at T+3D
    const runAt = "2026-10-04T10:00:00.000Z";
    await scheduler.scheduleAt("LeaveRequest.escalate", runAt, {}, {
      target: "leave-88",
      action: "LeaveRequest.escalate",
    });

    // Verify before T+3D it is not executed
    const tickBefore = await server.runner.tick("2026-10-01T10:00:00.000Z");
    expect(tickBefore).toBe(0);

    const recordBefore = await store.get("LeaveRequest", "leave-88");
    expect(recordBefore?.status).toBe("submitted");

    // 3. Tick at T+3D: executes transition to 'escalated'
    const tickDue = await server.runner.tick("2026-10-04T10:00:01.000Z");
    expect(tickDue).toBe(1);

    const recordAfter = await store.get("LeaveRequest", "leave-88");
    expect(recordAfter?.status).toBe("escalated");

    // 4. Tick again: already dispatched, executes 0
    const tickAgain = await server.runner.tick("2026-10-04T10:05:00.000Z");
    expect(tickAgain).toBe(0);
  });

  it("cancelling a timer prevents SchedulerRunner from executing it", async () => {
    const rawJson = readFileSync(
      resolve(process.cwd(), "examples/leave-request.kerangka.json"),
      "utf8"
    );
    const kir = JSON.parse(rawJson);
    const store = new MemoryStore();
    const scheduler = new MemoryScheduler();

    const server = new KerangkaServer(kir, {
      store,
      scheduler,
      quiet: true,
    });

    await store.create("LeaveRequest", {
      id: "leave-99",
      employeeId: "emp-99",
      days: 1,
      status: "submitted",
      startDate: "2026-10-01",
      endDate: "2026-10-02",
      assignedApproverRole: "team-lead",
    });

    await scheduler.scheduleAt("LeaveRequest.escalate", "2026-10-04T10:00:00.000Z", {}, {
      target: "leave-99",
      action: "LeaveRequest.escalate",
    });

    // Cancel timer for leave-99
    await scheduler.cancelByTarget("leave-99", "LeaveRequest.escalate");

    // Tick when due
    const executed = await server.runner.tick("2026-10-04T10:00:01.000Z");
    expect(executed).toBe(0);

    const record = await store.get("LeaveRequest", "leave-99");
    expect(record?.status).toBe("submitted"); // still submitted, not escalated
  });
});
