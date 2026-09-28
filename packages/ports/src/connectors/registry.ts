/**
 * Kerangka Default Connectors Registry
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { ConnectorsPort, ConnectorInvocation, ConnectorHandler, ConnectorError } from "../connectors.js";
import { HttpConnector, HttpConnectorOptions } from "./http.js";
import { SequenceConnector, SequenceConnectorOptions } from "./sequence.js";
import { EmailConnector, EmailConnectorOptions } from "./email.js";

export interface DefaultConnectorsOptions {
  http?: HttpConnectorOptions;
  sequence?: SequenceConnectorOptions;
  email?: EmailConnectorOptions;
}

/**
 * Standard Kerangka connectors registry implementing ConnectorsPort.
 * Provides out-of-the-box routing to standard 'http', 'sequence', and 'email' connectors.
 */
export class DefaultConnectors implements ConnectorsPort {
  private handlers = new Map<string, ConnectorHandler>();

  constructor(options: DefaultConnectorsOptions = {}) {
    this.register(new HttpConnector(options.http));
    this.register(new SequenceConnector(options.sequence));
    this.register(new EmailConnector(options.email));
  }

  register(handler: ConnectorHandler): this {
    this.handlers.set(handler.name, handler);
    return this;
  }

  get<H extends ConnectorHandler = ConnectorHandler>(name: string): H | undefined {
    return this.handlers.get(name) as H | undefined;
  }

  has(name: string): boolean {
    return this.handlers.has(name);
  }

  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  async call<T = unknown>(invocation: ConnectorInvocation): Promise<T> {
    const handler = this.handlers.get(invocation.connector);
    if (!handler) {
      throw new ConnectorError(
        `Connector '${invocation.connector}' is not registered. Registered connectors: [${this.list().join(", ")}]`,
        invocation.connector,
        invocation.operation,
        "CONNECTOR_NOT_FOUND"
      );
    }
    return handler.call<T>(invocation);
  }
}
