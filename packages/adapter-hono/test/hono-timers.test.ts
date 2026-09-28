import { describe, expect, it } from "vitest";
import { createKerangkaHonoApp } from "../src/index.js";
import { MemoryScheduler, MemoryStore } from "@kerangka/ports";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Hono HTTP Adapter Timers and Schedules Integration", () => {
  it("schedules a timer when transitioning via HTTP and cancels it on state exit", async () => {
    const rawJson = readFileSync(
      resolve(process.cwd(), "examples/leave-request.kerangka.json"),
      "utf8"
    );
    const kir = JSON.parse(rawJson);
    const store = new MemoryStore();
    const scheduler = new MemoryScheduler();

    const app = createKerangkaHonoApp(kir, {
      store,
      scheduler,
    });

    // 1. Create a draft leave request
    const createRes = await app.request("/api/leaverequest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "leave-77",
        employeeId: "emp-77",
        days: 2,
        status: "draft",
        startDate: "2026-10-01",
        endDate: "2026-10-03",
        assignedApproverRole: "team-lead",
      }),
    });
    expect(createRes.status).toBe(201);

    // 2. Submit the leave request (transitions draft -> submitted)
    // Entering 'submitted' state should trigger SLA timer for LeaveRequest.escalate at +3 days
    const submitRes = await app.request("/api/leaverequest/leave-77/transitions/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Roles": "employee",
      },
      body: JSON.stringify({}),
    });
    expect(submitRes.status).toBe(200);

    const dueJobsAfter3Days = await scheduler.getDueJobs("2026-10-05T00:00:00.000Z");
    const escalationTimer = dueJobsAfter3Days.find((j) => j.target === "leave-77");
    expect(escalationTimer).toBeDefined();
    expect(escalationTimer?.action).toBe("LeaveRequest.escalate");

    // 3. Approve the leave request before due date (transitions submitted -> approved)
    // Leaving 'submitted' state must cancel the escalation timer
    const approveRes = await app.request("/api/leaverequest/leave-77/transitions/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Roles": "team-lead",
      },
      body: JSON.stringify({}),
    });
    expect(approveRes.status).toBe(200);

    // After approval, the timer should be cancelled
    const dueJobsAfterApproval = await scheduler.getDueJobs("2026-10-05T00:00:00.000Z");
    const cancelledTimer = dueJobsAfterApproval.find((j) => j.target === "leave-77");
    expect(cancelledTimer).toBeUndefined();
  });
});
