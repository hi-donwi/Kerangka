/**
 * The single failure shape this bridge raises, mirroring UIDL-Runtime's `DataError`
 * (`UIDL-Runtime/packages/core/src/data/errors.ts`) so a document that branches on
 * `.code` behaves the same whether it is rendered against the mock adapter or against a
 * Kerangka backend.
 *
 * License: Apache-2.0
 */

export type DataErrorCode =
  | "not_found"
  | "validation"
  | "conflict"
  | "forbidden"
  | "network"
  | "timeout"
  | "server";

export class DataError extends Error {
  readonly code: DataErrorCode;
  /** Per-field messages, e.g. from server-side validation — maps to `state.formErrors.*`. */
  readonly fields?: Record<string, string>;

  constructor(message: string, code: DataErrorCode, fields?: Record<string, string>) {
    super(message);
    this.name = "DataError";
    this.code = code;
    this.fields = fields;
  }
}

export function isDataError(value: unknown): value is DataError {
  return value instanceof DataError;
}
