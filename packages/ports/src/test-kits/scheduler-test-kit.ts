/**
 * Reusable SchedulerPort Certification Test Kit
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { SchedulerPort } from "../scheduler.js";

export function createSchedulerTestKit(
  adapterName: string,
  factory: () => Promise<SchedulerPort> | SchedulerPort
): void {
  describe(`SchedulerPort Certification Test Kit: ${adapterName}`, () => {
    it("schedules delayed jobs and generates unique job identifiers", async () => {
      const scheduler = await factory();
      const jobId = await scheduler.scheduleDelayed("remindUser", { userId: "user-1" }, 60);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");
    });

    it("schedules jobs at specific instants and retrieves due jobs", async () => {
      const scheduler = await factory();
      const pastTime = new Date(Date.now() - 5000).toISOString();
      const futureTime = new Date(Date.now() + 60000).toISOString();

      const dueId = await scheduler.scheduleAt("pastJob", pastTime, { item: "due" }, { target: "rec-1" });
      const futureId = await scheduler.scheduleAt("futureJob", futureTime, { item: "future" }, { target: "rec-2" });

      expect(dueId).toBeDefined();
      expect(futureId).toBeDefined();

      const dueJobs = await scheduler.getDueJobs();
      expect(dueJobs.some((j) => j.id === dueId)).toBe(true);
      expect(dueJobs.some((j) => j.id === futureId)).toBe(false);
    });

    it("schedules recurring jobs with standard cron expressions", async () => {
      const scheduler = await factory();
      const jobId = await scheduler.scheduleCron("dailyReport", "0 0 * * *", { reportType: "sales" });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");
    });

    it("marks jobs dispatched cleanly", async () => {
      const scheduler = await factory();
      const pastTime = new Date(Date.now() - 1000).toISOString();
      const jobId = await scheduler.scheduleAt("dispatchMe", pastTime, {});

      const beforeDispatch = await scheduler.getDueJobs();
      expect(beforeDispatch.some((j) => j.id === jobId)).toBe(true);

      if (scheduler.markDispatched) {
        await scheduler.markDispatched(jobId);
        const afterDispatch = await scheduler.getDueJobs();
        expect(afterDispatch.some((j) => j.id === jobId)).toBe(false);
      }
    });

    it("cancels scheduled jobs by ID", async () => {
      const scheduler = await factory();
      const pastTime = new Date(Date.now() - 1000).toISOString();
      const jobId = await scheduler.scheduleAt("cancelMe", pastTime, {});

      await expect(scheduler.cancel(jobId)).resolves.not.toThrow();

      const dueJobs = await scheduler.getDueJobs();
      expect(dueJobs.some((j) => j.id === jobId)).toBe(false);
    });

    it("cancels scheduled jobs by target record ID", async () => {
      const scheduler = await factory();
      if (!scheduler.cancelByTarget) return;

      const pastTime = new Date(Date.now() - 1000).toISOString();
      const targetId = `target-${Date.now()}`;

      await scheduler.scheduleAt("job1", pastTime, {}, { target: targetId, action: "Order.cancel" });
      await scheduler.scheduleAt("job2", pastTime, {}, { target: targetId, action: "Order.escalate" });

      const cancelledCount = await scheduler.cancelByTarget(targetId, "Order.cancel");
      expect(cancelledCount).toBe(1);

      const dueJobs = await scheduler.getDueJobs();
      expect(dueJobs.some((j) => j.target === targetId && j.action === "Order.cancel")).toBe(false);
    });
  });
}
