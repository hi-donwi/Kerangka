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
    // Entering 'submitted' state triggers the SLA timer for LeaveRequest.escalate: the
    // `reviewLeave` task carries `due: "P3D"`, so it lands three days after this submit.
    // Derived from the clock, never written down — a fixed date here passes only until
    // the real date rolls past it.
    const submittedAt = Date.now();
    const slaDueAt = submittedAt + 3 * 24 * 60 * 60 * 1000;
    const afterSla = new Date(slaDueAt + 60_000);

    const submitRes = await app.request("/api/leaverequest/leave-77/transitions/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Actor-Roles": "employee",
      },
      body: JSON.stringify({}),
    });
    expect(submitRes.status).toBe(200);

    const notDueYet = await scheduler.getDueJobs(new Date(submittedAt));
    expect(notDueYet.find((j) => j.target === "leave-77")).toBeUndefined();

    const dueJobsAfter3Days = await scheduler.getDueJobs(afterSla);
    const escalationTimer = dueJobsAfter3Days.find((j) => j.target === "leave-77");
    expect(escalationTimer).toBeDefined();
    expect(escalationTimer?.action).toBe("LeaveRequest.escalate");
    expect(Math.abs(new Date(escalationTimer?.runAt ?? 0).getTime() - slaDueAt)).toBeLessThan(
      60_000
    );

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
    const dueJobsAfterApproval = await scheduler.getDueJobs(afterSla);
    const cancelledTimer = dueJobsAfterApproval.find((j) => j.target === "leave-77");
    expect(cancelledTimer).toBeUndefined();
  });
});
