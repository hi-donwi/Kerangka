/**
 * Kerangka In-Memory & Environment Secrets Adapters
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { SecretsPort } from "../secrets.js";

/**
 * In-memory secrets store for development, testing, and isolated execution.
 */
export class MemorySecrets implements SecretsPort {
  private secrets = new Map<string, string>();

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.secrets.set(key, value);
      }
    }
  }

  setSecret(key: string, value: string): void {
    this.secrets.set(key, value);
  }

  deleteSecret(key: string): boolean {
    return this.secrets.delete(key);
  }

  clear(): void {
    this.secrets.clear();
  }

  async getSecret(key: string): Promise<string | null> {
    return this.secrets.get(key) ?? null;
  }
}

/**
 * Environment-variable backed secrets provider.
 */
export class EnvSecrets implements SecretsPort {
  constructor(private prefix: string = "") {}

  async getSecret(key: string): Promise<string | null> {
    const fullKey = this.prefix ? `${this.prefix}${key}` : key;
    const val = typeof process !== "undefined" && process.env ? process.env[fullKey] : undefined;
    return val ?? null;
  }
}
