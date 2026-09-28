/**
 * Kerangka Scheduler Port Contract
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

export interface ScheduleOptions {
  id?: string;
  target?: string;
  action?: string;
  tenantId?: string;
}

export interface ScheduledJob {
  id: string;
  name: string;
  payload: unknown;
  cronExpr?: string;
  runAt?: string; // ISO 8601 UTC instant
  target?: string;
  action?: string;
  dispatchedAt?: string;
}

export interface SchedulerPort {
  /**
   * Schedules a one-time job delayed by a specific number of seconds.
   */
  scheduleDelayed(
    jobName: string,
    payload: unknown,
    delaySeconds: number,
    options?: ScheduleOptions
  ): Promise<string>;

  /**
   * Schedules a one-time job to execute at a specific instant (ISO string or Date).
   */
  scheduleAt(
    jobName: string,
    runAt: string | Date,
    payload: unknown,
    options?: ScheduleOptions
  ): Promise<string>;

  /**
   * Schedules a recurring job based on a standard 5-part cron expression.
   */
  scheduleCron(
    jobName: string,
    cronExpr: string,
    payload: unknown,
    options?: ScheduleOptions
  ): Promise<string>;

  /**
   * Cancels a scheduled job by its unique identifier.
   */
  cancel(jobId: string): Promise<void>;

  /**
   * Cancels pending scheduled jobs matching a target record ID and optional action.
   * Returns the count of cancelled jobs.
   */
  cancelByTarget?(target: string, action?: string): Promise<number>;

  /**
   * Retrieves all jobs due for execution at or before the given instant (defaults to now).
   */
  getDueJobs(now?: string | Date): Promise<ScheduledJob[]>;

  /**
   * Marks a scheduled job as dispatched / completed.
   */
  markDispatched?(jobId: string): Promise<void>;
}
