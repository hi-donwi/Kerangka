/**
 * Kerangka Scheduler Runner / Timer Dispatcher
 * Specification: PLAN.md §5.9 & §21
 * Status: Draft 0.2
 * License: Apache-2.0
 */

import { ScheduledJob, SchedulerPort } from "@kerangka/ports";

export interface SchedulerRunnerOptions {
  scheduler: SchedulerPort;
  executeJob: (job: ScheduledJob) => Promise<void>;
  pollIntervalMs?: number;
  onError?: (err: unknown, job: ScheduledJob) => void;
}

export class SchedulerRunner {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: SchedulerRunnerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
  }

  /**
   * Executes one tick: fetches due timers, executes them, and marks each dispatched.
   * Returns number of executed jobs.
   */
  async tick(now?: Date | string): Promise<number> {
    const dueJobs = await this.options.scheduler.getDueJobs(now);
    let executed = 0;

    for (const job of dueJobs) {
      try {
        await this.options.executeJob(job);
        if (this.options.scheduler.markDispatched) {
          await this.options.scheduler.markDispatched(job.id);
        }
        executed++;
      } catch (err) {
        this.options.onError?.(err, job);
      }
    }

    return executed;
  }

  /**
   * Starts periodic polling in background.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.tick();
      } catch (err) {
        // Suppress unhandled interval errors
      }
    }, this.pollIntervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops periodic polling.
   */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Returns true if the background polling loop is active.
   */
  isRunning(): boolean {
    return this.running;
  }
}
