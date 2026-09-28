/**
 * Kerangka External Connectors Port Contract
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

export interface ConnectorInvocation {
  connector: string;
  operation: string;
  payload?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  tenantId?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorHandler {
  readonly name: string;
  call<T = unknown>(invocation: ConnectorInvocation): Promise<T>;
}

export interface ConnectorsPort {
  /**
   * Invokes an external integration endpoint or service adapter.
   */
  call<T = unknown>(invocation: ConnectorInvocation): Promise<T>;

  /**
   * Checks whether a connector with the given name is registered.
   */
  has?(name: string): boolean;
}

/**
 * Standard base error for connector failures.
 */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly connector: string,
    public readonly operation: string,
    public readonly code: string = "CONNECTOR_ERROR",
    override readonly cause?: unknown
  ) {
    super(message, { cause });
    this.name = "ConnectorError";
  }
}

/**
 * Server-Side Request Forgery protection error.
 * Raised when an HTTP connector invocation targets private, internal, or loopback networks.
 */
export class SSRFBlockedError extends ConnectorError {
  constructor(
    message: string,
    connector: string,
    operation: string,
    public readonly blockedHost: string
  ) {
    super(message, connector, operation, "SSRF_BLOCKED");
    this.name = "SSRFBlockedError";
  }
}
