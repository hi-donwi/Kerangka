/**
 * Kerangka External Connectors Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface ConnectorInvocation {
  connector: string;
  operation: string;
  payload?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ConnectorsPort {
  /**
   * Invokes an external integration endpoint or service adapter.
   */
  call<T = unknown>(invocation: ConnectorInvocation): Promise<T>;
}
