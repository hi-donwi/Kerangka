/**
 * In-Memory Scheduler Adapter
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { ScheduledJob, SchedulerPort, ScheduleOptions } from "../scheduler.js";

export class MemoryScheduler implements SchedulerPort {
  private jobs: ScheduledJob[] = [];

  /**
   * Schedules a one-time job delayed by a specific number of seconds.
   */
  async scheduleDelayed(
    jobName: string,
    payload: unknown,
    delaySeconds: number,
    options?: ScheduleOptions
  ): Promise<string> {
    const runAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
    return this.scheduleAt(jobName, runAt, payload, options);
  }

  /**
   * Schedules a one-time job to execute at a specific instant.
   */
  async scheduleAt(
    jobName: string,
    runAt: string | Date,
    payload: unknown,
    options?: ScheduleOptions
  ): Promise<string> {
    const id = options?.id ?? randomUUID();
    const runAtIso = typeof runAt === "string" ? new Date(runAt).toISOString() : runAt.toISOString();

    const job: ScheduledJob = {
      id,
      name: jobName,
      payload,
      runAt: runAtIso,
      target: options?.target,
      action: options?.action,
    };

    this.jobs.push(job);
    return id;
  }

  /**
   * Schedules a recurring job based on a standard 5-part cron expression.
   */
  async scheduleCron(
    jobName: string,
    cronExpr: string,
    payload: unknown,
    options?: ScheduleOptions
  ): Promise<string> {
    const id = options?.id ?? randomUUID();

    const job: ScheduledJob = {
      id,
      name: jobName,
      payload,
      cronExpr,
      target: options?.target,
      action: options?.action,
    };

    this.jobs.push(job);
    return id;
  }

  /**
   * Cancels a scheduled job by its unique identifier.
   */
  async cancel(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.dispatchedAt = new Date().toISOString();
    }
  }

  /**
   * Cancels pending scheduled jobs matching a target record ID and optional action.
   */
  async cancelByTarget(target: string, action?: string): Promise<number> {
    let count = 0;
    const nowIso = new Date().toISOString();

    for (const job of this.jobs) {
      if (!job.dispatchedAt && job.target === target) {
        if (!action || job.action === action) {
          job.dispatchedAt = nowIso;
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Retrieves all jobs due for execution at or before the given instant.
   */
  async getDueJobs(now?: string | Date): Promise<ScheduledJob[]> {
    const nowMs = now ? (typeof now === "string" ? new Date(now).getTime() : now.getTime()) : Date.now();

    return this.jobs
      .filter((j) => {
        if (j.dispatchedAt) return false;
        if (j.runAt) {
          return new Date(j.runAt).getTime() <= nowMs;
        }
        return false;
      })
      .map((j) => structuredClone(j));
  }

  /**
   * Marks a scheduled job as dispatched.
   */
  async markDispatched(jobId: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (job) {
      job.dispatchedAt = new Date().toISOString();
    }
  }

  /**
   * Helper to inspect all jobs (useful for test assertions).
   */
  inspectJobs(): readonly ScheduledJob[] {
    return this.jobs;
  }

  /**
   * Clears all jobs.
   */
  clear(): void {
    this.jobs = [];
  }
}
