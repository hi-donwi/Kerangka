/**
 * Kerangka Field Shorthand Parser
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { FieldDefinition } from "./types.js";

/**
 * Parses a string shorthand into a canonical FieldDefinition.
 * Examples:
 *   "string!"
 *   "string! unique"
 *   "ref(Customer)!"
 *   "list(Line)"
 *   "enum(draft, sent, paid, void) = draft"
 *   "decimal(12,2)! >= 0"
 *   "int! >= 0 = 0"
 */
export function parseFieldShorthand(shorthand: string): FieldDefinition {
  let text = shorthand.trim();

  // 1. Extract default value: e.g. " = 0" or " = draft" or " = today()"
  let defaultValue: unknown = undefined;
  const defaultIdx = text.indexOf(" = ");
  if (defaultIdx !== -1) {
    const rawDef = text.substring(defaultIdx + 3).trim();
    text = text.substring(0, defaultIdx).trim();

    if (rawDef === "true") defaultValue = true;
    else if (rawDef === "false") defaultValue = false;
    else if (rawDef === "null") defaultValue = null;
    else if (/^-?\d+(\.\d+)?$/.test(rawDef)) defaultValue = Number(rawDef);
    else defaultValue = rawDef;
  }

  // 2. Extract min constraint: e.g. ">= 0" or ">= 1"
  let min: number | undefined = undefined;
  const minMatch = text.match(/>=\s*(-?\d+(\.\d+)?)/);
  if (minMatch) {
    min = Number(minMatch[1]);
    text = text.replace(minMatch[0], "").trim();
  }

  // 3. Extract max constraint: e.g. "<= 100"
  let max: number | undefined = undefined;
  const maxMatch = text.match(/<=\s*(-?\d+(\.\d+)?)/);
  if (maxMatch) {
    max = Number(maxMatch[1]);
    text = text.replace(maxMatch[0], "").trim();
  }

  // 4. Extract unique modifier
  let unique = false;
  if (/\bunique\b/.test(text)) {
    unique = true;
    text = text.replace(/\bunique\b/, "").trim();
  }

  // 5. Extract required modifier: "!" or "?"
  let required = false;
  if (text.includes("!")) {
    required = true;
    text = text.replace(/!/g, "").trim();
  } else if (text.includes("?")) {
    required = false;
    text = text.replace(/\?/g, "").trim();
  }

  // 6. Parse base type and parameters
  // Ref: ref(Customer) or ref<Customer>
  const refMatch = text.match(/^ref(?:<|\()([a-zA-Z0-9_]+)(?:>|\))$/);
  if (refMatch) {
    return {
      type: "ref",
      target: refMatch[1],
      required,
      ...(unique ? { unique: true } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    };
  }

  // List: list(Line) or list<Line> or list<string>
  const listMatch = text.match(/^list(?:<|\()([a-zA-Z0-9_]+)(?:>|\))$/);
  if (listMatch) {
    const innerName = listMatch[1]!;
    const isPrimitive = ["string", "int", "decimal", "bool", "date", "datetime", "uuid"].includes(innerName);
    const element: FieldDefinition = isPrimitive
      ? { type: innerName, required: true }
      : { type: "ref", target: innerName, required: true };

    return {
      type: "list",
      element,
      required,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    };
  }

  // Enum: enum(val1, val2, ...)
  const enumMatch = text.match(/^enum\(([^)]+)\)$/);
  if (enumMatch) {
    const values = enumMatch[1]!
      .split(",")
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);

    return {
      type: "enum",
      values,
      required,
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    };
  }

  // Decimal with precision and scale: decimal(12,2)
  const decimalMatch = text.match(/^decimal\((\d+),(\d+)\)$/);
  if (decimalMatch) {
    return {
      type: "decimal",
      precision: parseInt(decimalMatch[1]!, 10),
      scale: parseInt(decimalMatch[2]!, 10),
      required,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(unique ? { unique: true } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    };
  }

  // Normalize aliases
  let baseType = text;
  if (baseType === "bool") baseType = "boolean";

  return {
    type: baseType,
    required,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(unique ? { unique: true } : {}),
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

/**
 * Normalizes a field definition from either a shorthand string or an object.
 */
export function normalizeField(input: string | FieldDefinition): FieldDefinition {
  if (typeof input === "string") {
    return parseFieldShorthand(input);
  }

  // If already an object, its `type` might contain shorthand e.g. "decimal(12,2)"
  let base = { ...input };
  if (base.type && (base.type.includes("(") || base.type.includes("!") || base.type.includes("?"))) {
    const parsed = parseFieldShorthand(base.type);
    base = { ...parsed, ...base, type: parsed.type };
  }

  if (base.required === undefined) {
    base.required = false;
  }

  return base;
}
