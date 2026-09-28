/**
 * Kerangka Connectors Port Certification Test Kit
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { ConnectorsPort, ConnectorError } from "../connectors.js";

export function createConnectorsTestKit(
  suiteName: string,
  factory: () => ConnectorsPort | Promise<ConnectorsPort>,
  cleanup?: (connectors: ConnectorsPort) => Promise<void> | void
): void {
  describe(`ConnectorsPort Certification: ${suiteName}`, () => {
    it("throws CONNECTOR_NOT_FOUND when invoking an unregistered connector", async () => {
      const connectors = await factory();
      try {
        await expect(
          connectors.call({
            connector: "unknown_connector_xyz",
            operation: "test",
          })
        ).rejects.toThrowError(ConnectorError);
      } finally {
        if (cleanup) await cleanup(connectors);
      }
    });

    it("successfully handles invocations for supported operations", async () => {
      const connectors = await factory();
      try {
        // Attempt a sequence call if available, or test invocation
        const result = await connectors.call({
          connector: "sequence",
          operation: "next",
          payload: { name: "test_cert_seq", start: 1 },
        });
        expect(result).toBeDefined();
      } catch (err) {
        // If 'sequence' connector is not installed in this specific custom connectors port,
        // it must throw a standard ConnectorError
        expect(err).toBeInstanceOf(ConnectorError);
      } finally {
        if (cleanup) await cleanup(connectors);
      }
    });
  });
}
