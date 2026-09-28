/**
 * StoreScheduler Adapter
 * Backed by StorePort's Database Timer Table (_timers)
 * Specification: ADR-0015 / PLAN.md §8.1 & §21
 * Status: Draft 0.2
 * License: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import { ScheduledJob, SchedulerPort, ScheduleOptions } from "./scheduler.js";
import { StorePort } from "./store.js";

export class StoreScheduler implements SchedulerPort {
  constructor(readonly store: StorePort) {}

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
    const triggerAt = typeof runAt === "string" ? new Date(runAt).toISOString() : runAt.toISOString();

    await this.store.enqueueTimer({
      id,
      target: options?.target ?? jobName,
      triggerAt,
      payload: {
        jobName,
        action: options?.action,
        payload,
      },
    });

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
    // Default initial execution: 60s from now
    const runAt = new Date(Date.now() + 60 * 1000).toISOString();

    await this.store.enqueueTimer({
      id,
      target: options?.target ?? jobName,
      triggerAt: runAt,
      payload: {
        jobName,
        action: options?.action,
        cronExpr,
        payload,
      },
    });

    return id;
  }

  /**
   * Cancels a scheduled job by marking it dispatched.
   */
  async cancel(jobId: string): Promise<void> {
    await this.store.markTimerDispatched(jobId);
  }

  /**
   * Cancels pending scheduled jobs matching a target record ID and optional action.
   */
  async cancelByTarget(target: string, action?: string): Promise<number> {
    // Fetch upcoming timers up to 10 years in the future to find matches
    const futureDate = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
    const timers = await this.store.fetchDueTimers(futureDate, 1000);
    let count = 0;

    for (const timer of timers) {
      if (timer.target === target) {
        const p = timer.payload as Record<string, unknown> | undefined;
        if (!action || p?.action === action) {
          await this.store.markTimerDispatched(timer.id);
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
    const entries = await this.store.fetchDueTimers(now);
    return entries.map((entry) => {
      const p = entry.payload as Record<string, unknown> | undefined;
      return {
        id: entry.id,
        name: (p?.jobName as string) ?? entry.target,
        target: entry.target,
        action: p?.action as string | undefined,
        payload: p?.payload !== undefined ? p.payload : entry.payload,
        runAt: entry.triggerAt,
        cronExpr: p?.cronExpr as string | undefined,
        dispatchedAt: entry.dispatchedAt,
      };
    });
  }

  /**
   * Marks a scheduled job as dispatched.
   */
  async markDispatched(jobId: string): Promise<void> {
    await this.store.markTimerDispatched(jobId);
  }
}
