/**
 * Kerangka Built-in Sequence Connector
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { ConnectorHandler, ConnectorInvocation, ConnectorError } from "../connectors.js";
import { StorePort } from "../store.js";

export interface SequenceConnectorOptions {
  /**
   * Optional persistence store for storing sequences across restarts.
   */
  store?: StorePort;

  /**
   * Table / collection name in store for sequence state.
   * Defaults to "_sequences".
   */
  tableName?: string;
}

export interface SequencePayload {
  name: string;
  pattern?: string;
  start?: number;
  step?: number;
  tenantId?: string;
  prefix?: string;
  date?: string | Date;
}

export interface SequenceResult {
  sequence: string;
  value: number;
  name: string;
  tenantId?: string;
}

export class SequenceConnector implements ConnectorHandler {
  readonly name = "sequence";
  private memoryCounters = new Map<string, number>();
  private store?: StorePort;
  private tableName: string;

  constructor(options: SequenceConnectorOptions = {}) {
    this.store = options.store;
    this.tableName = options.tableName || "_sequences";
  }

  private getCompositeKey(name: string, tenantId?: string): string {
    return tenantId ? `${tenantId}:${name}` : name;
  }

  private formatPattern(pattern: string, seqNum: number, dateObj: Date, prefix?: string): string {
    const year = dateObj.getFullYear();
    const yy = String(year).slice(-2);
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");

    let result = pattern;

    // Replace date tokens
    result = result.replaceAll("${YYYY}", String(year));
    result = result.replaceAll("${year}", String(year));
    result = result.replaceAll("${YY}", yy);
    result = result.replaceAll("${MM}", month);
    result = result.replaceAll("${month}", month);
    result = result.replaceAll("${DD}", day);
    result = result.replaceAll("${day}", day);

    if (prefix !== undefined) {
      result = result.replaceAll("${prefix}", prefix);
    }

    // Replace ${seq} and ${seq:PAD}
    result = result.replace(/\$\{seq(?::(\d+))?\}/g, (_match, padStr) => {
      if (padStr) {
        const padLen = parseInt(padStr, 10);
        return String(seqNum).padStart(padLen, "0");
      }
      return String(seqNum);
    });

    return result;
  }

  async call<T = unknown>(invocation: ConnectorInvocation): Promise<T> {
    const operation = (invocation.operation || "next").toLowerCase();
    const payload = (invocation.payload || {}) as SequencePayload;

    const seqName = payload.name;
    if (!seqName) {
      throw new ConnectorError(
        "Sequence connector requires a 'name' in payload.",
        this.name,
        operation,
        "INVALID_PAYLOAD"
      );
    }

    const tenantId = payload.tenantId || invocation.tenantId;
    const startVal = payload.start !== undefined ? payload.start : 1;
    const stepVal = payload.step !== undefined ? payload.step : 1;
    const pattern = payload.pattern || "${seq}";
    const dateObj = payload.date ? new Date(payload.date) : new Date();

    const compKey = this.getCompositeKey(seqName, tenantId);

    if (operation === "reset") {
      const resetTo = payload.start !== undefined ? payload.start : 0;
      this.memoryCounters.set(compKey, resetTo);
      if (this.store) {
        const stored = await this.store.get(this.tableName, compKey, { tenantId });
        const record = { id: compKey, name: seqName, currentVal: resetTo, updatedAt: new Date().toISOString() };
        if (stored) {
          await this.store.update(this.tableName, compKey, record, { tenantId });
        } else {
          await this.store.create(this.tableName, record, { tenantId });
        }
      }
      const formatted = this.formatPattern(pattern, resetTo, dateObj, payload.prefix);
      return {
        sequence: formatted,
        value: resetTo,
        name: seqName,
        tenantId,
      } as T;
    }

    if (operation === "current") {
      let currentVal = this.memoryCounters.get(compKey);
      if (currentVal === undefined && this.store) {
        const stored = await this.store.get(this.tableName, compKey, { tenantId });
        if (stored && typeof stored.currentVal === "number") {
          currentVal = stored.currentVal;
          this.memoryCounters.set(compKey, currentVal);
        }
      }
      const val = currentVal !== undefined ? currentVal : startVal - 1;
      const formatted = this.formatPattern(pattern, val, dateObj, payload.prefix);
      return {
        sequence: formatted,
        value: val,
        name: seqName,
        tenantId,
      } as T;
    }

    if (operation === "next") {
      let nextVal: number;

      if (this.store) {
        // If store is configured, fetch or initialize
        const stored = await this.store.get(this.tableName, compKey, { tenantId });
        if (stored && typeof stored.currentVal === "number") {
          nextVal = stored.currentVal + stepVal;
        } else {
          nextVal = startVal;
        }
        const record = { id: compKey, name: seqName, currentVal: nextVal, updatedAt: new Date().toISOString() };
        if (stored) {
          await this.store.update(this.tableName, compKey, record, { tenantId });
        } else {
          await this.store.create(this.tableName, record, { tenantId });
        }
        this.memoryCounters.set(compKey, nextVal);
      } else {
        const prev = this.memoryCounters.get(compKey);
        nextVal = prev !== undefined ? prev + stepVal : startVal;
        this.memoryCounters.set(compKey, nextVal);
      }

      const formatted = this.formatPattern(pattern, nextVal, dateObj, payload.prefix);
      const res: SequenceResult = {
        sequence: formatted,
        value: nextVal,
        name: seqName,
        tenantId,
      };

      return res as T;
    }

    throw new ConnectorError(
      `Unsupported operation '${operation}' for sequence connector. Use 'next', 'current', or 'reset'.`,
      this.name,
      operation,
      "UNSUPPORTED_OPERATION"
    );
  }
}
