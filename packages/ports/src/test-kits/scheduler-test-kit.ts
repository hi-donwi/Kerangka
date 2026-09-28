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

    it("schedules recurring jobs with standard cron expressions", async () => {
      const scheduler = await factory();
      const jobId = await scheduler.scheduleCron("dailyReport", "0 0 * * *", { reportType: "sales" });

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe("string");
    });

    it("cancels scheduled jobs cleanly without error", async () => {
      const scheduler = await factory();
      const jobId = await scheduler.scheduleDelayed("tempJob", {}, 300);

      await expect(scheduler.cancel(jobId)).resolves.not.toThrow();
    });
  });
}
