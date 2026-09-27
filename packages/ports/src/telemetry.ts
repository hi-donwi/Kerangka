/**
 * Kerangka Telemetry Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface MetricTags {
  [tag: string]: string | number | boolean;
}

export interface TelemetryPort {
  /**
   * Records a business or runtime metric counter / gauge / histogram.
   */
  recordMetric(name: string, value: number, tags?: MetricTags): void;

  /**
   * Traces an asynchronous operation under a named OpenTelemetry span.
   */
  trace<T>(spanName: string, fn: () => Promise<T>, attributes?: Record<string, string>): Promise<T>;

  /**
   * Emits a structured log line.
   */
  log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>
  ): void;
}
