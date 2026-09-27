/**
 * Kerangka Scheduler Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface ScheduledJob {
  id: string;
  name: string;
  payload: unknown;
  cronExpr?: string;
  runAt?: string;
}

export interface SchedulerPort {
  /**
   * Schedules a one-time job delayed by a specific number of seconds.
   */
  scheduleDelayed(jobName: string, payload: unknown, delaySeconds: number): Promise<string>;

  /**
   * Schedules a recurring job based on a standard 5-part cron expression.
   */
  scheduleCron(jobName: string, cronExpr: string, payload: unknown): Promise<string>;

  /**
   * Cancels a scheduled job by its unique identifier.
   */
  cancel(jobId: string): Promise<void>;
}
