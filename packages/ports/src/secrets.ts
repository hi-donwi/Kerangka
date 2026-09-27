/**
 * Kerangka Secrets Port Contract
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

export interface SecretsPort {
  /**
   * Retrieves a secret string value by key from the vault or environment.
   */
  getSecret(key: string): Promise<string | null>;
}
